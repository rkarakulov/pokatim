import {
  AchievementList,
  type AchievementCode,
  AppAppearance,
  ApiError,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRouteViewer,
  RiderProfileViewer,
  CatalogRoutePage,
  type CatalogRouteQuery,
  type RouteExportFormat,
  type CatalogRouteRacesQuery,
  CalendarCities,
  CalendarMonths,
  CalendarPage,
  type CalendarQuery,
  CalendarStartDetail,
  CurrentSeasonResponse,
  RaceDetail,
  RacePage,
  RaceRouteMap,
  RouteMapGeometry,
  type RaceListQuery,
  MySeasonStandings,
  SeasonCard,
  SeasonStandingsSummary,
  SeasonStandingsTable,
  SeasonList,
  type SeasonRaceListQuery,
  ConfirmPasswordResetResponse,
  ConfirmVerificationResponse,
  type ErrorCode,
  HealthResponse,
  NotificationPage,
  NotificationSettings,
  EventNotificationSettingsView,
  type UpdateEventNotificationSettings,
  type RegisterPushToken,
  type RevokePushToken,
  type RegisterWebPushSubscription,
  type RevokeWebPushSubscription,
  WebPushConfig,
  UnreadCount,
  OnboardingStatus,
  PasswordResetLinkInfo,
  ProfileView,
  PublicRiderAchievementList,
  PublicRiderProfile,
  PublicRiderRacePage,
  type RiderHistoryQuery,
  RiderRaceHistoryPage,
  RiderRideHistoryPage,
  RiderStats,
  RefreshSessionResponse,
  RegisterResponse,
  RegistrationPollResponse,
  RequestPasswordResetResponse,
  ResendVerificationResponse,
  SignInResponse,
  VerificationLinkInfo,
  type ConfirmPasswordResetRequest,
  type ConfirmVerificationRequest,
  type RefreshSessionRequest,
  type RegisterRequest,
  type RegistrationPollRequest,
  type RequestPasswordResetRequest,
  type ResendVerificationRequest,
  type SessionTransport,
  type SignInRequest,
  type SignOutRequest,
  type SubmitOnboardingSurveyRequest,
  type UpdateProfileRequest,
  type UpdateProfileThemeRequest,
  type DeleteAccountRequest,
  TrackUpload,
  TrackUploadPage,
  AttemptCandidates,
  MyAttemptTrack,
  MyRaceEntry,
  RaceResultsPage,
  RaceFinishersPage,
  type RaceFinishersQuery,
  type RaceEntryRequest,
  VerifiedProfileView,
  type UpdateVerifiedProfileRequest,
  type AttemptRequest,
  type RaceResultsQuery,
  ConnectDeviceResponse,
  DeviceList,
  type CompleteDeviceRequest,
  type CompleteDevicesStepRequest,
  type ConnectDeviceRequest,
  type DeviceProvider,
  type DisconnectDeviceRequest,
  type CancelRideRequest,
  type CreateRideRequest,
  type CreateRideReportRequest,
  type CreateRouteReportRequest,
  type CreateProfileReportRequest,
  RideCities,
  RideDetail,
  type RideListQuery,
  RideMap,
  RidePage,
  RideView,
  type UpdateRideRequest,
  DisputeAgainstMe,
  MyDispute,
  MyRaceDisputes,
  type DisputeFileRequest,
  type DisputeResponseRequest,
  MyRoute,
  MyRoutePage,
  RouteRideCandidates,
  RouteRideDetail,
  RouteRidePage,
  type RouteRideRequest,
  RouteRideTrack,
  type RenameRouteInput,
  type SubmitRoutePublicationInput,
  StoryCardStatus,
  type StoryCardQuery,
  type OgCardKind,
  OgCardMeta,
  CalendarRegistrationState,
  type CalendarRegistrationRequest,
  EventTicketingPublic,
  EventMaterialList,
  MyTicketRef,
  MyTickets,
  type TicketEventKind,
  TicketView,
} from '@pokatim/contracts';
import {
  ApiHttpError,
  createHttpClient,
  parseApiError,
  type ParsedApiError as BaseParsedApiError,
} from '@rkarakulov/api-client-core';
import { z } from 'zod';

import { queryString, type SeasonStandingsTableParams } from './admin.ts';

export {
  ApiHttpError,
  ApiNetworkError,
  isNetworkError,
  parseApiError,
} from '@rkarakulov/api-client-core';

/** Ошибка API для UI: код из контракта проекта или `UNKNOWN`, если сервер новее клиента или ответил не API. */
export type ParsedApiError = BaseParsedApiError<ErrorCode>;

/**
 * Разобранная ошибка ответа сервера по кодам проекта; `undefined` — ответа не было (сеть, прочее).
 * Разбирает `body` заново: код не зависит от того, кто создал `ApiHttpError` (клиент, тест, другой пакет).
 */
export function apiErrorOf(error: unknown): ParsedApiError | undefined {
  return error instanceof ApiHttpError ? parseApiError(error.body, ApiError) : undefined;
}

/** Параметры списка гонок приложения до схемы (`bikeClass`, `month` — массивы). */
export type RaceListParams = {
  scope?: RaceListQuery['scope'];
  bikeClass?: NonNullable<RaceListQuery['bikeClass']>;
  month?: NonNullable<RaceListQuery['month']>;
  cursor?: string;
  limit?: number;
};

/** Параметры каталога маршрутов до схемы (`city`, `distance`, `surface`, `author` — массивы, повтором ключа). */
export type CatalogRouteListParams = {
  /** routes-06: `team` — маршруты команды, `rider` — маршруты райдеров. */
  author?: NonNullable<CatalogRouteQuery['author']>;
  city?: NonNullable<CatalogRouteQuery['city']>;
  distance?: NonNullable<CatalogRouteQuery['distance']>;
  surface?: NonNullable<CatalogRouteQuery['surface']>;
  cursor?: string;
  limit?: number;
};

/** Параметры гонок маршрута каталога до схемы (`CatalogRouteRacesQuery`). */
export type CatalogRouteRacesParams = Partial<Pick<CatalogRouteRacesQuery, 'cursor' | 'limit'>>;

/** Параметры гонок сезона до схемы (`SeasonRaceListQuery`). */
export type SeasonRaceListParams = Partial<Pick<SeasonRaceListQuery, 'cursor' | 'limit'>>;

/** Параметры календаря приложения до схемы; `from` не задан — сервер берёт «сегодня по Минску». */
export type CalendarListParams = {
  from?: string;
  discipline?: NonNullable<CalendarQuery['discipline']>;
  city?: NonNullable<CalendarQuery['city']>;
  month?: NonNullable<CalendarQuery['month']>;
  cursor?: string;
  limit?: number;
};

/** Параметры центра уведомлений до схемы (`NotificationListQuery`). */
export type NotificationListParams = { cursor?: string; limit?: number };

/**
 * Параметры ленты кофе-райдов до схемы (`city` — массив кодов справочника). `near` — `"<lat>,<lon>"`, клиент
 * округляет до 0,01° (05c, ADR-0014); `radiusKm` — 5…100, без него сервер берёт 25.
 */
export type RideListParams = {
  city?: NonNullable<RideListQuery['city']>;
  cursor?: string;
  limit?: number;
  near?: string;
  radiusKm?: number;
};

/** Параметры карты ленты (05c): как у ленты, без курсора и лимита. */
export type RideMapParams = Pick<RideListParams, 'city' | 'near' | 'radiusKm'>;

/** Обрезка аватара — доли ориентированного изображения (`AvatarCropQuery`). */
export interface AvatarCrop {
  x: number;
  y: number;
  size: number;
}

/** Параметры историй профиля (`RiderHistoryQuery`). */
export type RiderHistoryParams = Partial<Pick<RiderHistoryQuery, 'cursor' | 'limit'>>;

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  /** `fetch` credentials каждого запроса; web — `include` (cookie сессии к API на другом origin в dev). */
  credentials?: RequestCredentials;
  /** Как сервер выдаёт сессию (poll, вход): web — `cookie`; не задан — `body` (native). */
  sessionTransport?: SessionTransport;
}

/** Тонкий клиент: каждый ответ валидируется той же zod-схемой, что и на сервере. */
export function createApiClient({
  baseUrl,
  getAccessToken,
  fetchImpl,
  credentials,
  sessionTransport,
}: ApiClientOptions) {
  const { request } = createHttpClient({
    baseUrl,
    getAccessToken,
    fetchImpl,
    errorSchema: ApiError,
  });
  // публичное чтение (Q14): тот же клиент без getAccessToken — токен в эти запросы не уходит
  const { request: requestPublic } = createHttpClient({
    baseUrl,
    fetchImpl,
    errorSchema: ApiError,
  });
  const withCredentials = credentials ? { credentials } : {};
  const getPublic = <S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}) =>
    requestPublic(path, schema, { method: 'GET', ...withCredentials, ...init });
  const get = <S extends z.ZodType>(path: string, schema: S) =>
    request(path, schema, { method: 'GET', ...withCredentials });
  const post = <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
    request(path, schema, { method: 'POST', body: JSON.stringify(body), ...withCredentials });
  /** Запрос под `AuthGuard`: access — явным параметром, только в методы, требующие входа (R2). */
  const authorized = (accessToken: string, init: RequestInit): RequestInit => ({
    ...init,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const postAuthorized = <S extends z.ZodType>(
    accessToken: string,
    path: string,
    schema: S,
    body: unknown,
  ) =>
    request(
      path,
      schema,
      authorized(accessToken, { method: 'POST', body: JSON.stringify(body), ...withCredentials }),
    );
  /** Транспорт сессии платформы — в тело запросов, которые выдают сессию. */
  const withTransport = <B extends object>(body: B) =>
    sessionTransport ? { sessionTransport, ...body } : body;

  /** Путь загрузки заезда: `?name=` — исходное имя файла только для показа. */
  const trackUploadPath = (name?: string) =>
    `/v1/tracks/uploads${name ? queryString({ name }) : ''}`;
  /** Путь загрузки своего маршрута: `?title=` — название (`RouteTitle`). */
  const myRoutesUploadPath = (title: string) => `/v1/routes/mine${queryString({ title })}`;
  /** Путь загрузки аватара: обрезка — доли `x, y, size` ориентированного изображения (без них — центр). */
  const avatarPath = (crop?: AvatarCrop) => `/v1/profile/avatar${crop ? queryString(crop) : ''}`;
  const octetStream = (accessToken: string) => ({
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/octet-stream',
  });

  return {
    health: () => get('/v1/health', HealthResponse),
    register: (body: RegisterRequest) => post('/v1/auth/register', RegisterResponse, body),
    /** Только чтение: открытие ссылки ничего не меняет на сервере. */
    getVerificationLink: (token: string) =>
      get(`/v1/auth/verification/${encodeURIComponent(token)}`, VerificationLinkInfo),
    confirmVerification: (body: ConfirmVerificationRequest) =>
      post('/v1/auth/verification/confirm', ConfirmVerificationResponse, body),
    resendVerification: (body: ResendVerificationRequest) =>
      post('/v1/auth/verification/resend', ResendVerificationResponse, body),
    pollRegistration: (body: RegistrationPollRequest) =>
      post('/v1/auth/registration/poll', RegistrationPollResponse, withTransport(body)),
    /** Вход по паролю: сессия по транспорту платформы или `verificationRequired` (e-mail не подтверждён). */
    signIn: (body: Omit<SignInRequest, 'sessionTransport'>) =>
      post('/v1/auth/session/sign-in', SignInResponse, withTransport(body)),
    /** Ротация сессии: без `refreshToken` — refresh из cookie (web), ответ без него. */
    refreshSession: (body: RefreshSessionRequest = {}) =>
      post('/v1/auth/session/refresh', RefreshSessionResponse, body),
    /** Выход: отзыв сессии (refresh из тела или cookie); ответ 204 без тела. */
    signOut: (body: SignOutRequest = {}) => post('/v1/auth/session/sign-out', z.undefined(), body),
    /** Запрос ссылки сброса пароля: один ответ для любого адреса. Путь вне cookie сессии. */
    requestPasswordReset: (body: RequestPasswordResetRequest) =>
      post('/v1/auth/password-reset', RequestPasswordResetResponse, body),
    /** Только чтение: открытие ссылки сброса ничего не меняет на сервере. */
    getPasswordResetLink: (token: string) =>
      get(`/v1/auth/password-reset/${encodeURIComponent(token)}`, PasswordResetLinkInfo),
    /** Смена пароля по ссылке: отзывает все сессии аккаунта, свою не выдаёт. */
    confirmPasswordReset: (body: ConfirmPasswordResetRequest) =>
      post('/v1/auth/password-reset/confirm', ConfirmPasswordResetResponse, body),
    /** Статус онбординга (вход обязателен): только признак «опрос пройден». */
    getOnboardingStatus: (accessToken: string) =>
      request(
        '/v1/profile/onboarding',
        OnboardingStatus,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Профиль своего пользователя (вход обязателен): ответы опроса, неизвестные коды отброшены. */
    getProfile: (accessToken: string) =>
      request(
        '/v1/profile',
        ProfileView,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Частичное обновление публичного имени и согласия на показ (вход обязателен); ответ — профиль после записи. */
    updateProfile: (accessToken: string, body: UpdateProfileRequest) =>
      request(
        '/v1/profile',
        ProfileView,
        authorized(accessToken, {
          method: 'PATCH',
          body: JSON.stringify(body),
          ...withCredentials,
        }),
      ),
    /** Личная тема приложения (user-theme, вход обязателен); ответ — профиль после записи. */
    setProfileTheme: (accessToken: string, body: UpdateProfileThemeRequest) =>
      request(
        '/v1/profile/theme',
        ProfileView,
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
    /** Анкета зачёта Verified (race-results-07, вход обязателен); нет анкеты — `profile: null` и подсказка года. */
    getVerifiedProfile: (accessToken: string) =>
      request(
        '/v1/profile/verified',
        VerifiedProfileView,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Анкета целиком; пол и год после первой Verified-заявки — только прежние (`409 VERIFIED_DEMOGRAPHICS_LOCKED`).
     */
    updateVerifiedProfile: (accessToken: string, body: UpdateVerifiedProfileRequest) =>
      request(
        '/v1/profile/verified',
        VerifiedProfileView,
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
    /**
     * Фото профиля (rider-profile): сырые байты JPEG/PNG/WebP ≤ 10 МиБ (`application/octet-stream`), обрезка —
     * намерение (доли), квадрат 512 px считает сервер. Ответ — профиль; отказы — `ApiHttpError` (413, 415, 422, 429).
     */
    uploadAvatar: (accessToken: string, body: Blob | Uint8Array, crop?: AvatarCrop) =>
      request(avatarPath(crop), ProfileView, {
        method: 'PUT',
        body: body as BodyInit,
        headers: octetStream(accessToken),
        ...withCredentials,
      }),
    /** Тот же запрос для платформенной отправки (upload task в native): ответ разбирается `ProfileView`. */
    avatarUploadRequest: (accessToken: string, crop?: AvatarCrop) => ({
      url: `${baseUrl}${avatarPath(crop)}`,
      method: 'PUT' as const,
      headers: octetStream(accessToken),
    }),
    /** Удалить фото профиля (идемпотентно); ответ — профиль с `avatar: null`. */
    deleteAvatar: (accessToken: string) =>
      postAuthorized(accessToken, '/v1/profile/avatar/delete', ProfileView, {}),
    /** Адрес картинки аватара (публичный, без запроса). */
    avatarUrl: (id: string) => `${baseUrl}/v1/avatars/${encodeURIComponent(id)}`,
    /** Статистика своего профиля (вход обязателен). */
    getProfileStats: (accessToken: string) =>
      request(
        '/v1/profile/stats',
        RiderStats,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** «Гонки» своего профиля: свои заявки без снятых, новые гонки сверху. */
    listProfileRaces: (accessToken: string, params: RiderHistoryParams = {}) =>
      request(
        `/v1/profile/races${queryString(params)}`,
        RiderRaceHistoryPage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** «Райды» своего профиля: прошедшие с «Иду» или организацией. */
    listProfileRides: (accessToken: string, params: RiderHistoryParams = {}) =>
      request(
        `/v1/profile/rides${queryString(params)}`,
        RiderRideHistoryPage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Публичный профиль райдера по `publicId` (без входа); нет или нет согласия — 404. */
    getRider: (publicId: string) =>
      getPublic(`/v1/riders/${encodeURIComponent(publicId)}`, PublicRiderProfile),
    /** Состояние вошедшего зрителя публичного профиля (profile-moderation): «Пожаловаться» / «Вы пожаловались». */
    getRiderViewer: (accessToken: string, publicId: string) =>
      request(
        `/v1/riders/${encodeURIComponent(publicId)}/me`,
        RiderProfileViewer,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Жалоба на публичный профиль (идемпотентно при открытой); свой — 409 `PROFILE_INVALID_STATE`, лимит — 429. */
    reportRider: (accessToken: string, publicId: string, body: CreateProfileReportRequest) =>
      postAuthorized(
        accessToken,
        `/v1/riders/${encodeURIComponent(publicId)}/reports`,
        RiderProfileViewer,
        body,
      ),
    /** Публичная история гонок райдера — только опубликованные протоколы. */
    listRiderRaces: (publicId: string, params: RiderHistoryParams = {}) =>
      getPublic(
        `/v1/riders/${encodeURIComponent(publicId)}/races${queryString(params)}`,
        PublicRiderRacePage,
      ),
    /** Свои достижения: сверка с фактами на сервере (A2), от новых к старым; `seen: false` — для вспышки. */
    listAchievements: (accessToken: string) =>
      request(
        '/v1/achievements',
        AchievementList,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Отметить показанные вспышкой (идемпотентно; чужие, незнакомые и отозванные — без ошибки); `204`. */
    markAchievementsSeen: (accessToken: string, codes: AchievementCode[]) =>
      postAuthorized(accessToken, '/v1/achievements/seen', z.undefined(), { codes }),
    /** Публичные достижения райдера — только гоночные (без входа); нет или нет согласия — 404. */
    getRiderAchievements: (publicId: string) =>
      getPublic(
        `/v1/riders/${encodeURIComponent(publicId)}/achievements`,
        PublicRiderAchievementList,
      ),
    // --- билеты на мероприятия (event-tickets) ---
    /** Свой билет гонки — сервер выпускает лениво (зовите после «Участвовать»); нет заявки или билетов — `null`. */
    getRaceTicket: (accessToken: string, raceId: string) =>
      request(
        `/v1/races/${encodeURIComponent(raceId)}/ticket`,
        MyTicketRef.nullable(),
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Своя активная регистрация на старт календаря и билет; нет — оба `null`. */
    getCalendarRegistration: (accessToken: string, startId: string) =>
      request(
        `/v1/calendar/${encodeURIComponent(startId)}/registration`,
        CalendarRegistrationState,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Регистрация на старт календаря (201 — новая, 200 — уже была). Отказы — `409 EVENT_FULL`,
     * `409 EVENT_REGISTRATION_CLOSED { reason }`, `400` (дистанция), `429 RATE_LIMITED`.
     */
    registerForCalendar: (
      accessToken: string,
      startId: string,
      body: CalendarRegistrationRequest = {},
    ) =>
      postAuthorized(
        accessToken,
        `/v1/calendar/${encodeURIComponent(startId)}/registration`,
        CalendarRegistrationState,
        body,
      ),
    /** Отмена регистрации (до старта; повтор — без ошибки). */
    cancelCalendarRegistration: (accessToken: string, startId: string) =>
      postAuthorized(
        accessToken,
        `/v1/calendar/${encodeURIComponent(startId)}/registration/cancel`,
        CalendarRegistrationState,
        {},
      ),
    /** Свои билеты: предстоящие и прошедшие (без курсора). */
    listTickets: (accessToken: string) =>
      request(
        '/v1/tickets',
        MyTickets,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Свой билет по коду (`XXXXX-XXXXX` или 10 символов); чужой и неизвестный — 404. */
    getTicket: (accessToken: string, code: string) =>
      request(
        `/v1/tickets/${encodeURIComponent(code)}`,
        TicketView,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Публичная сводка регистрации события (без входа); билеты не включены — `{ enabled: false }`. `fresh` — в обход
     * HTTP-кэша (`public, max-age=60`): места после своей регистрации и отказа 409. Query у пути нет — `_=` от
     * `whatwg-fetch` (React Native) сервер не читает.
     */
    getEventTicketing: (
      kind: TicketEventKind,
      eventId: string,
      options: { fresh?: boolean } = {},
    ) =>
      getPublic(
        `/v1/events/${encodeURIComponent(kind)}/${encodeURIComponent(eventId)}/ticketing`,
        EventTicketingPublic,
        options.fresh ? { cache: 'no-cache' } : {},
      ),
    /** PR C: материалы события по порядку (без входа); событие не опубликовано — 404. */
    getEventMaterials: (kind: TicketEventKind, eventId: string) =>
      getPublic(
        `/v1/events/${encodeURIComponent(kind)}/${encodeURIComponent(eventId)}/materials`,
        EventMaterialList,
      ),
    /** Адрес PDF материала (без входа, скачивание; удалён — 404) — для `openExternalUrl`, без запроса. */
    eventFileUrl: (fileId: string) => `${baseUrl}/v1/event-files/${encodeURIComponent(fileId)}`,
    /**
     * Удаление своего аккаунта (вход обязателен), подтверждение — текущий пароль; `204` без тела, все сессии отозваны
     * (web — cookie сброшена ответом). Отказы — `ApiHttpError`: `403 PASSWORD_INCORRECT`, `409 ACCOUNT_PANEL_MEMBER`,
     * `429 RATE_LIMITED`.
     */
    deleteAccount: (accessToken: string, body: DeleteAccountRequest) =>
      request(
        '/v1/account/delete',
        z.undefined(),
        authorized(accessToken, { method: 'POST', body: JSON.stringify(body), ...withCredentials }),
      ),
    /** Ответ опроса «Что вас привело?» (вход обязателен); повтор перезаписывает ответ. */
    submitOnboardingSurvey: (accessToken: string, body: SubmitOnboardingSurveyRequest) =>
      request(
        '/v1/profile/onboarding/survey',
        OnboardingStatus,
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),

    // --- read-модель гонок, сезона и календаря: публично, без Authorization (admin-02 S7) ---
    /** Гонки: `current` — с незакрытым окном (по началу), `past` — закрытые и отменённые. */
    listRaces: (params: RaceListParams = {}) =>
      getPublic(`/v1/races${queryString(params)}`, RacePage),
    /** Опубликованная или отменённая гонка; черновик и неизвестная — 404. */
    getRace: (id: string) => getPublic(`/v1/races/${encodeURIComponent(id)}`, RaceDetail),
    /** Линия показа и коридор гонки для карты (ADR-0014); без коридора, черновик, маршрут не готов — 404. */
    getRaceRoute: (id: string) =>
      getPublic(`/v1/races/${encodeURIComponent(id)}/route`, RaceRouteMap),
    /** Сезон, в который попадает «сейчас», или `null`. */
    getCurrentSeason: () => getPublic('/v1/seasons/current', CurrentSeasonResponse),
    /** Все сезоны, новые сверху. */
    listSeasons: () => getPublic('/v1/seasons', SeasonList),
    /** Сезон по id; неизвестный — 404. */
    getSeason: (id: string) => getPublic(`/v1/seasons/${encodeURIComponent(id)}`, SeasonCard),
    /** Опубликованные и отменённые гонки сезона по концу окна; неизвестный сезон — 404. */
    listSeasonRaces: (id: string, params: SeasonRaceListParams = {}) =>
      getPublic(`/v1/seasons/${encodeURIComponent(id)}/races${queryString(params)}`, RacePage),
    /** Рейтинг сезона (race-results-08) — публично: таблицы «класс × группа»; неизвестный сезон — 404. */
    getSeasonStandings: (id: string) =>
      getPublic(`/v1/seasons/${encodeURIComponent(id)}/standings`, SeasonStandingsSummary),
    /**
     * Таблица сезона (без `userId`); таблицы нет в снимке — пустая страница. `fresh` — в обход HTTP-кэша
     * (`public, max-age=60`): перезапрос после расхождения снимков (08c, RC-11). Не для React Native: `whatwg-fetch`
     * дописывает `_=` в URL, а query таблицы строгий (400).
     */
    getSeasonStandingsTable: (
      id: string,
      params: SeasonStandingsTableParams,
      options: { fresh?: boolean } = {},
    ) =>
      getPublic(
        `/v1/seasons/${encodeURIComponent(id)}/standings/table${queryString(params)}`,
        SeasonStandingsTable,
        options.fresh ? { cache: 'no-cache' } : {},
      ),
    /** Свои строки во всех таблицах сезона (вход обязателен, `no-store`). */
    getMySeasonStandings: (accessToken: string, id: string) =>
      request(
        `/v1/seasons/${encodeURIComponent(id)}/standings/me`,
        MySeasonStandings,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),

    // --- каталог маршрутов команды (routes-01): публично, без токена ---
    listCatalogRoutes: (params: CatalogRouteListParams = {}) =>
      getPublic(`/v1/routes${queryString(params)}`, CatalogRoutePage),
    listCatalogRouteCities: () => getPublic('/v1/routes/cities', CatalogRouteCities),
    /** Не опубликован или неизвестен — 404. */
    getCatalogRoute: (id: string) =>
      getPublic(`/v1/routes/${encodeURIComponent(id)}`, CatalogRouteDetail),
    /** Линия показа, старт, финиш, рамка (без коридора). */
    getCatalogRouteMap: (id: string) =>
      getPublic(`/v1/routes/${encodeURIComponent(id)}/map`, RouteMapGeometry),
    /**
     * Адрес файла маршрута каталога в формате `format` (GPX — routes-03; KML, TCX — routes-formats) — без запроса:
     * файл скачивает браузер или ОС (`Content-Disposition: attachment`).
     */
    catalogRouteExportUrl: (id: string, format: RouteExportFormat) =>
      `${baseUrl}/v1/routes/${encodeURIComponent(id)}/${format}`,
    /** Адрес очищенного GPX (routes-03) — `catalogRouteExportUrl(id, 'gpx')`. */
    catalogRouteGpxUrl: (id: string) => `${baseUrl}/v1/routes/${encodeURIComponent(id)}/gpx`,
    /** Публичные гонки с коридором по маршруту, новые окна сверху; маршрут не в каталоге — 404. */
    listCatalogRouteRaces: (id: string, params: CatalogRouteRacesParams = {}) =>
      getPublic(`/v1/routes/${encodeURIComponent(id)}/races${queryString(params)}`, RacePage),
    /** Опубликованные старты с `from` (по умолчанию — сегодня по Минску). */
    listCalendar: (params: CalendarListParams = {}) =>
      getPublic(`/v1/calendar${queryString(params)}`, CalendarPage),
    getCalendarStart: (id: string) =>
      getPublic(`/v1/calendar/${encodeURIComponent(id)}`, CalendarStartDetail),
    listCalendarCities: () => getPublic('/v1/calendar/cities', CalendarCities),
    /** Месяцы будущих опубликованных стартов — чипы «Дата». */
    listCalendarMonths: () => getPublic('/v1/calendar/months', CalendarMonths),
    /**
     * Оформление приложения: публично, `no-cache`; сезонный декор. `themeId` устарел — сервер user-theme всегда
     * отдаёт `classic` (личная тема — `getProfile().themeId`).
     */
    getAppearance: () => getPublic('/v1/appearance', AppAppearance),

    // --- кофе-райды (блок 05): карточка — публично; лента, города, состояние зрителя и мутации — вход обязателен ---
    /** Будущие райды по времени старта (+ отменённые свои), роль зрителя в каждой карточке. */
    listRides: (accessToken: string, params: RideListParams = {}) =>
      request(
        `/v1/rides${queryString(params)}`,
        RidePage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Карта ленты (05c): точки старта будущих райдов с видимым маршрутом + число райдов без точки. */
    listRideMap: (accessToken: string, params: RideMapParams = {}) =>
      request(
        `/v1/rides/map${queryString(params)}`,
        RideMap,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Города, где есть видимые зрителю будущие райды. */
    listRideCities: (accessToken: string) =>
      request(
        '/v1/rides/cities',
        RideCities,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Публичная карточка без зрителя: опубликованный, отменённый, прошедший; неизвестный — 404. */
    getRide: (id: string) => getPublic(`/v1/rides/${encodeURIComponent(id)}`, RideDetail),
    /** Карточка + состояние зрителя (роль, права); организатору — с `version`. */
    getRideForViewer: (accessToken: string, id: string) =>
      request(
        `/v1/rides/${encodeURIComponent(id)}/me`,
        RideView,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    createRide: (accessToken: string, body: CreateRideRequest) =>
      postAuthorized(accessToken, '/v1/rides', RideView, body),
    /** Правка организатором: изменённые поля + `version` (устарела — 409 `CONFLICT`). */
    updateRide: (accessToken: string, id: string, body: UpdateRideRequest) =>
      postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}`, RideView, body),
    cancelRide: (accessToken: string, id: string, body: CancelRideRequest) =>
      postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}/cancel`, RideView, body),
    /** «Я иду» (идемпотентно); мест нет — 409 `RIDE_FULL`. */
    joinRide: (accessToken: string, id: string) =>
      postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}/join`, RideView, {}),
    /** «Не иду» (идемпотентно); организатор — 409 `RIDE_INVALID_STATE`. */
    leaveRide: (accessToken: string, id: string) =>
      postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}/leave`, RideView, {}),
    /** Жалоба на райд (05b, идемпотентно); организатор — 409 `RIDE_INVALID_STATE`, лимит — 429. */
    reportRide: (accessToken: string, id: string, body: CreateRideReportRequest) =>
      postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}/reports`, RideView, body),

    // --- заезды: ручная загрузка FIT/GPX (вход обязателен, tracks-devices) ---
    /**
     * Загрузка файла заезда сырыми байтами (`application/octet-stream`): `202` — новая, `200` — тот же файл уже есть.
     * Формат сервер определяет по содержимому.
     */
    uploadTrack: (accessToken: string, body: Blob | Uint8Array, name?: string) =>
      request(trackUploadPath(name), TrackUpload, {
        method: 'POST',
        body: body as BodyInit,
        headers: octetStream(accessToken),
        ...withCredentials,
      }),
    /**
     * Тот же запрос для платформенной отправки с прогрессом (XHR в web, upload task в native): ответ разбирается
     * `TrackUpload`, ошибка — `ApiHttpError`.
     */
    trackUploadRequest: (accessToken: string, name?: string) => ({
      url: `${baseUrl}${trackUploadPath(name)}`,
      method: 'POST' as const,
      headers: octetStream(accessToken),
    }),
    getTrackUpload: (accessToken: string, id: string) =>
      request(
        `/v1/tracks/uploads/${encodeURIComponent(id)}`,
        TrackUpload,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Свои загрузки, новые сверху. */
    listTrackUploads: (accessToken: string, params: { limit?: number; cursor?: string } = {}) =>
      request(
        `/v1/tracks/uploads${queryString(params)}`,
        TrackUploadPage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Удаление своей загрузки вместе с заездом; ответ 204. */
    deleteTrackUpload: (accessToken: string, id: string) =>
      request(
        `/v1/tracks/uploads/${encodeURIComponent(id)}/delete`,
        z.undefined(),
        authorized(accessToken, { method: 'POST', body: '{}', ...withCredentials }),
      ),

    // --- мои маршруты: GPX/KML райдера (вход обязателен, routes-02) ---
    /** Загрузка файла маршрута сырыми байтами: `202` — в обработке (новый или повтор отказа), `200` — тот же файл. */
    uploadMyRoute: (accessToken: string, body: Blob | Uint8Array, title: string) =>
      request(myRoutesUploadPath(title), MyRoute, {
        method: 'POST',
        body: body as BodyInit,
        headers: octetStream(accessToken),
        ...withCredentials,
      }),
    /** Тот же запрос для платформенной отправки с прогрессом: ответ разбирается `MyRoute`. */
    myRouteUploadRequest: (accessToken: string, title: string) => ({
      url: `${baseUrl}${myRoutesUploadPath(title)}`,
      method: 'POST' as const,
      headers: octetStream(accessToken),
    }),
    /** Свои маршруты, новые сверху. */
    listMyRoutes: (accessToken: string, params: { limit?: number; cursor?: string } = {}) =>
      request(
        `/v1/routes/mine${queryString(params)}`,
        MyRoutePage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    getMyRoute: (accessToken: string, id: string) =>
      request(
        `/v1/routes/mine/${encodeURIComponent(id)}`,
        MyRoute,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Линия показа своего готового маршрута; не готов, чужой, удалён — 404. */
    getMyRouteMap: (accessToken: string, id: string) =>
      request(
        `/v1/routes/mine/${encodeURIComponent(id)}/map`,
        RouteMapGeometry,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    renameMyRoute: (accessToken: string, id: string, body: RenameRouteInput) =>
      postAuthorized(
        accessToken,
        `/v1/routes/mine/${encodeURIComponent(id)}/rename`,
        MyRoute,
        body,
      ),
    /** Удаление насовсем (маршрут, линия, исходник); ответ 204, повтор — 404. */
    deleteMyRoute: (accessToken: string, id: string) =>
      request(
        `/v1/routes/mine/${encodeURIComponent(id)}/delete`,
        z.undefined(),
        authorized(accessToken, { method: 'POST', body: '{}', ...withCredentials }),
      ),
    /**
     * Заявка в каталог (routes-06): `409 ROUTE_INVALID_STATE` (`details.reason`), `409 ROUTE_PUBLICATION_LIMIT`
     * (`details.limit`), 429 — суточный лимит.
     */
    submitMyRoutePublication: (
      accessToken: string,
      id: string,
      body: SubmitRoutePublicationInput,
    ) =>
      postAuthorized(
        accessToken,
        `/v1/routes/mine/${encodeURIComponent(id)}/publish`,
        MyRoute,
        body,
      ),
    /** Отозвать заявку или снять с публикации (идемпотентно); скрыт модератором — 409 `hidden`. */
    unpublishMyRoute: (accessToken: string, id: string) =>
      postAuthorized(
        accessToken,
        `/v1/routes/mine/${encodeURIComponent(id)}/unpublish`,
        MyRoute,
        {},
      ),
    /** Состояние вошедшего зрителя карточки каталога (routes-06): «Пожаловаться» / «Вы пожаловались». */
    getCatalogRouteViewer: (accessToken: string, id: string) =>
      request(
        `/v1/routes/${encodeURIComponent(id)}/me`,
        CatalogRouteViewer,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Жалоба на маршрут райдера (идемпотентно); свой и команды — 409 `ROUTE_INVALID_STATE`, лимит — 429. */
    reportCatalogRoute: (accessToken: string, id: string, body: CreateRouteReportRequest) =>
      postAuthorized(
        accessToken,
        `/v1/routes/${encodeURIComponent(id)}/reports`,
        CatalogRouteViewer,
        body,
      ),

    // --- участие в гонке и результаты (race-results-03) ---
    /** Предварительная таблица гонки — публично, анонимные строки; черновик и неизвестная — 404. */
    getRaceResults: (raceId: string, params: Partial<RaceResultsQuery> = {}) =>
      getPublic(
        `/v1/races/${encodeURIComponent(raceId)}/results${queryString(params)}`,
        RaceResultsPage,
      ),
    /** Моё участие (вход обязателен): заявка, видимые попытки, результат, действия; не заявлен — `entry: null`. */
    getMyRaceEntry: (accessToken: string, raceId: string) =>
      request(
        `/v1/races/${encodeURIComponent(raceId)}/entry`,
        MyRaceEntry,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Свой трек попытки с разметкой схода (maps-02): чужая, скрытая и неизвестная — `404`. */
    getMyAttemptTrack: (accessToken: string, raceId: string, attemptId: string) =>
      request(
        `/v1/races/${encodeURIComponent(raceId)}/entry/attempts/${encodeURIComponent(attemptId)}/track`,
        MyAttemptTrack,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Карточка для сторис своего результата (story-cards): `pending` — рендер в очереди (опрашивать), `ready` — токен
     * картинки (`storyCardImageUrl`), `failed` — рендер не удался (повтор ставит заново); карточки нет — 409
     * `STORY_CARD_UNAVAILABLE`.
     */
    getStoryCard: (accessToken: string, raceId: string, query: StoryCardQuery) =>
      request(
        `/v1/races/${encodeURIComponent(raceId)}/entry/story-card${queryString(query)}`,
        StoryCardStatus,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Карточка-приглашение кофе-райда (ADR-0018): статусы — как у `getStoryCard`; скрытый и неизвестный райд — 404,
     * не будущий — 409 `STORY_CARD_UNAVAILABLE`. Картинка — тем же `storyCardImageUrl`.
     */
    getRideInviteCard: (accessToken: string, rideId: string, query: StoryCardQuery) =>
      request(
        `/v1/rides/${encodeURIComponent(rideId)}/invite-card${queryString(query)}`,
        StoryCardStatus,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Карточка своего полученного достижения (achievement-story-card): `pending` | `ready` + токен | `failed`; не
     * получено или отозвано — 409 `STORY_CARD_UNAVAILABLE`. Картинка — тем же `storyCardImageUrl`.
     */
    getAchievementCard: (accessToken: string, code: AchievementCode, query: StoryCardQuery) =>
      request(
        `/v1/achievements/${encodeURIComponent(code)}/story-card${queryString(query)}`,
        StoryCardStatus,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /**
     * Карточка маршрута каталога для сторис (route-story-card): `pending` | `ready` + токен | `failed`; маршрут не в
     * каталоге (заявка, снят, скрыт, личный, неизвестный) — 404 `NOT_FOUND`. Картинка — тем же `storyCardImageUrl`.
     */
    getRouteStoryCard: (accessToken: string, routeId: string, query: StoryCardQuery) =>
      request(
        `/v1/routes/${encodeURIComponent(routeId)}/story-card${queryString(query)}`,
        StoryCardStatus,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Адрес PNG карточки по токену (капабилити-ссылка без входа, живёт ≤ 24 ч); без запроса. */
    storyCardImageUrl: (token: string) =>
      `${baseUrl}/v1/story-cards/${encodeURIComponent(token)}.png`,
    /**
     * Текущая версия OG-картинки публичного объекта (og-images, ADR-0018) — для «Поделиться» с картинкой файлом;
     * непубличный объект — 404.
     */
    getOgCard: (kind: OgCardKind, id: string) =>
      getPublic(`/v1/og/cards/${kind}/${encodeURIComponent(id)}`, OgCardMeta),
    /** Адрес OG-PNG 1200×630 по версии (`getOgCard`); без запроса. */
    ogImageUrl: (kind: OgCardKind, id: string, version: string) =>
      `${baseUrl}/v1/og/images/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(version)}.png`,
    /**
     * «Участвовать» (`201` — новая заявка, `200` — уже заявлен) и «Повысить до Verified» (race-results-07):
     * `tier`/`groupKey` — намерение; без тела — новая заявка START (в старой гонке — как v1).
     */
    enterRace: (accessToken: string, raceId: string, body: NonNullable<RaceEntryRequest> = {}) =>
      postAuthorized(
        accessToken,
        `/v1/races/${encodeURIComponent(raceId)}/entry`,
        MyRaceEntry,
        body,
      ),
    /** Финишёры гонки (race-results-07): START и Verified без пульса — время без места, публично. */
    getRaceFinishers: (raceId: string, params: Partial<RaceFinishersQuery> = {}) =>
      getPublic(
        `/v1/races/${encodeURIComponent(raceId)}/finishers${queryString(params)}`,
        RaceFinishersPage,
      ),
    /** «Отменить участие»: повторная заявка на эту гонку невозможна. */
    withdrawFromRace: (accessToken: string, raceId: string) =>
      postAuthorized(
        accessToken,
        `/v1/races/${encodeURIComponent(raceId)}/entry/withdraw`,
        MyRaceEntry,
        {},
      ),
    /** «Выбрать свой заезд» (`activityId`) или «загрузить в гонку» после `uploadTrack` (`uploadId`). */
    addRaceAttempt: (accessToken: string, raceId: string, body: AttemptRequest) =>
      postAuthorized(
        accessToken,
        `/v1/races/${encodeURIComponent(raceId)}/attempts`,
        MyRaceEntry,
        body,
      ),
    /** Свои заезды, пересекающие окно гонки (≤ 50), с отметкой «уже попытка». */
    listAttemptCandidates: (accessToken: string, raceId: string) =>
      request(
        `/v1/races/${encodeURIComponent(raceId)}/attempt-candidates`,
        AttemptCandidates,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),

    // --- заезд по маршруту (route-rides-01): только свои, вход обязателен ---
    /** Свои заезды по маршруту (каталог или свой готовый): сводка и строки; маршрут не виден — `404`. */
    listRouteRides: (accessToken: string, routeId: string) =>
      request(
        `/v1/routes/${encodeURIComponent(routeId)}/rides`,
        RouteRidePage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Свои заезды за 365 дней у рамки маршрута (≤ 30) с отметкой уже проверенного заезда группы. */
    listRouteRideCandidates: (accessToken: string, routeId: string) =>
      request(
        `/v1/routes/${encodeURIComponent(routeId)}/rides/candidates`,
        RouteRideCandidates,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** «Проверить заезд» (`201` — новый, `200` — уже есть); загрузка в обработке — `409 ROUTE_RIDE_NOT_READY`. */
    checkRouteRide: (accessToken: string, routeId: string, body: RouteRideRequest) =>
      postAuthorized(
        accessToken,
        `/v1/routes/${encodeURIComponent(routeId)}/rides`,
        RouteRideDetail,
        body,
      ),
    /** Заезд по маршруту: статус, вердикт, время, сравнение со своими пройденными. */
    getRouteRide: (accessToken: string, routeId: string, rideId: string) =>
      request(
        `/v1/routes/${encodeURIComponent(routeId)}/rides/${encodeURIComponent(rideId)}`,
        RouteRideDetail,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Своя линия заезда и разметка схода (как `getMyAttemptTrack`). */
    getRouteRideTrack: (accessToken: string, routeId: string, rideId: string) =>
      request(
        `/v1/routes/${encodeURIComponent(routeId)}/rides/${encodeURIComponent(rideId)}/track`,
        RouteRideTrack,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),

    // --- споры по результатам (race-results-06) ---
    /** Приём споров и мои споры в гонке: поданные мной и по моему результату (D-51). */
    getMyRaceDisputes: (accessToken: string, raceId: string) =>
      request(
        `/v1/races/${encodeURIComponent(raceId)}/disputes`,
        MyRaceDisputes,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** «Оспорить результат»: `201 MyDispute`; отказ — `409 DISPUTE_ACTION_BLOCKED` с причиной. */
    fileDispute: (accessToken: string, raceId: string, body: DisputeFileRequest) =>
      postAuthorized(
        accessToken,
        `/v1/races/${encodeURIComponent(raceId)}/disputes`,
        MyDispute,
        body,
      ),
    /** «Отозвать спор» (только заявитель, только открытый); подать снова нельзя. */
    withdrawDispute: (accessToken: string, disputeId: string) =>
      postAuthorized(
        accessToken,
        `/v1/disputes/${encodeURIComponent(disputeId)}/withdraw`,
        MyDispute,
        {},
      ),
    /** Ответ участника, чей результат оспорен (один раз). */
    respondToDispute: (accessToken: string, disputeId: string, body: DisputeResponseRequest) =>
      postAuthorized(
        accessToken,
        `/v1/disputes/${encodeURIComponent(disputeId)}/response`,
        DisputeAgainstMe,
        body,
      ),

    // --- центр уведомлений (вход обязателен, ADR-0017): только свои ---
    /** Новые сверху, курсор; незнакомая цель — `{ type: 'unknown' }` (без перехода). */
    listNotifications: (accessToken: string, params: NotificationListParams = {}) =>
      request(
        `/v1/notifications${queryString(params)}`,
        NotificationPage,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Непрочитанные (не больше 100 — колокольчик показывает «99+»). */
    getUnreadCount: (accessToken: string) =>
      request(
        '/v1/notifications/unread-count',
        UnreadCount,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Отметить прочитанным (повтор — тоже 204); чужое или неизвестное — `404 NOT_FOUND`. */
    markNotificationRead: (accessToken: string, id: string) =>
      postAuthorized(
        accessToken,
        `/v1/notifications/${encodeURIComponent(id)}/read`,
        z.undefined(),
        {},
      ),
    /** «Прочитать все»; `204`. */
    markAllNotificationsRead: (accessToken: string) =>
      postAuthorized(accessToken, '/v1/notifications/read-all', z.undefined(), {}),
    /** Настройки: нет сохранённых — умолчания сервера. */
    getNotificationSettings: (accessToken: string) =>
      request(
        '/v1/notifications/settings',
        NotificationSettings,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Полная замена настроек; ответ — сохранённые. */
    updateNotificationSettings: (accessToken: string, body: NotificationSettings) =>
      request(
        '/v1/notifications/settings',
        NotificationSettings,
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
    /** Тумблеры группы «Мероприятия» (подресурс, RC-D1); нет сохранённых — включено. */
    getEventNotificationSettings: (accessToken: string) =>
      request(
        '/v1/notifications/settings/events',
        EventNotificationSettingsView,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Полная замена тумблеров «Мероприятия»; ответ — сохранённые. */
    updateEventNotificationSettings: (accessToken: string, body: UpdateEventNotificationSettings) =>
      request(
        '/v1/notifications/settings/events',
        EventNotificationSettingsView,
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
    /** Регистрация или обновление push-токена этого устройства; `204`. */
    registerPushToken: (accessToken: string, body: RegisterPushToken) =>
      request(
        '/v1/notifications/push-tokens',
        z.undefined(),
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
    /** Снять push-токен этого устройства (до выхода); `204` и для чужого/неизвестного. */
    revokePushToken: (accessToken: string, body: RevokePushToken) =>
      postAuthorized(accessToken, '/v1/notifications/push-tokens/revoke', z.undefined(), body),
    /** Публичный VAPID-ключ Web Push (ADR-0022); `publicKey: null` — сервер Web Push не шлёт. */
    getWebPushConfig: (accessToken: string) =>
      request(
        '/v1/notifications/web-push',
        WebPushConfig,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Подписка Web Push этого браузера (upsert по endpoint); `204`. */
    registerWebPushSubscription: (accessToken: string, body: RegisterWebPushSubscription) =>
      request(
        '/v1/notifications/web-push/subscriptions',
        z.undefined(),
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
    /** Снять подписку Web Push этого браузера (до выхода); `204` и для чужой/неизвестной. */
    revokeWebPushSubscription: (accessToken: string, body: RevokeWebPushSubscription) =>
      postAuthorized(
        accessToken,
        '/v1/notifications/web-push/subscriptions/revoke',
        z.undefined(),
        body,
      ),

    // --- устройства через агрегатор (вход обязателен, tracks-devices) ---
    listDevices: (accessToken: string) =>
      request(
        '/v1/devices',
        DeviceList,
        authorized(accessToken, { method: 'GET', ...withCredentials }),
      ),
    /** Ссылка авторизации агрегатора; `returnUrl` — из allowlist сервера. */
    connectDevice: (accessToken: string, provider: DeviceProvider, body: ConnectDeviceRequest) =>
      postAuthorized(accessToken, `/v1/devices/${provider}/connect`, ConnectDeviceResponse, body),
    /** Активация подключения тикетом из возврата авторизации. */
    completeDevice: (accessToken: string, provider: DeviceProvider, body: CompleteDeviceRequest) =>
      postAuthorized(accessToken, `/v1/devices/${provider}/complete`, DeviceList, body),
    /** «Синхронизировать сейчас» (не чаще раза в 10 минут — иначе 429). */
    syncDevice: (accessToken: string, provider: DeviceProvider) =>
      postAuthorized(accessToken, `/v1/devices/${provider}/sync`, DeviceList, {}),
    disconnectDevice: (
      accessToken: string,
      provider: DeviceProvider,
      body: DisconnectDeviceRequest,
    ) => postAuthorized(accessToken, `/v1/devices/${provider}/disconnect`, DeviceList, body),
    /** Шаг онбординга «Подключите устройство» пройден (любой исход). */
    completeDevicesStep: (accessToken: string, body: CompleteDevicesStepRequest) =>
      request(
        '/v1/profile/onboarding/devices',
        OnboardingStatus,
        authorized(accessToken, { method: 'PUT', body: JSON.stringify(body), ...withCredentials }),
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export {
  createAdminApiClient,
  type AdminApiClient,
  type AdminApiClientOptions,
  type AuditListParams,
  type PanelCalendarListParams,
  type PanelRaceListParams,
  type SeasonStandingsTableParams,
} from './admin.ts';
