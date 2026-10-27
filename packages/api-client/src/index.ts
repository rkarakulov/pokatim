import {
  AppAppearance,
  ApiError,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  type CatalogRouteQuery,
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
  SeasonCard,
  SeasonList,
  type SeasonRaceListQuery,
  ConfirmPasswordResetResponse,
  ConfirmVerificationResponse,
  type ErrorCode,
  HealthResponse,
  NotificationPage,
  NotificationSettings,
  type RegisterPushToken,
  type RevokePushToken,
  UnreadCount,
  OnboardingStatus,
  PasswordResetLinkInfo,
  ProfileView,
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
  type DeleteAccountRequest,
  TrackUpload,
  TrackUploadPage,
  AttemptCandidates,
  MyAttemptTrack,
  MyRaceEntry,
  RaceResultsPage,
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
  RideCities,
  RideDetail,
  type RideListQuery,
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
  type RenameRouteInput,
} from '@pokatim/contracts';
import {
  ApiHttpError,
  createHttpClient,
  parseApiError,
  type ParsedApiError as BaseParsedApiError,
} from '@rkarakulov/api-client-core';
import { z } from 'zod';

import { queryString } from './admin.ts';

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

/** Параметры каталога маршрутов до схемы (`city`, `distance`, `surface` — массивы, повтором ключа). */
export type CatalogRouteListParams = {
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

/** Параметры ленты кофе-райдов до схемы (`city` — массив кодов справочника). */
export type RideListParams = {
  city?: NonNullable<RideListQuery['city']>;
  cursor?: string;
  limit?: number;
};

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
  const getPublic = <S extends z.ZodType>(path: string, schema: S) =>
    requestPublic(path, schema, { method: 'GET', ...withCredentials });
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
     * Адрес очищенного GPX маршрута каталога (routes-03) — без запроса: файл скачивает браузер или ОС
     * (`Content-Disposition: attachment`).
     */
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
    /** Тема приложения (app-themes): публично, кэш 60 с; незнакомая тема — `'unknown'` (клиент → «Классика»). */
    getAppearance: () => getPublic('/v1/appearance', AppAppearance),

    // --- кофе-райды (блок 05): карточка — публично; лента, города, состояние зрителя и мутации — вход обязателен ---
    /** Будущие райды по времени старта (+ отменённые свои), роль зрителя в каждой карточке. */
    listRides: (accessToken: string, params: RideListParams = {}) =>
      request(
        `/v1/rides${queryString(params)}`,
        RidePage,
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
    /** «Участвовать»: `201` — новая заявка, `200` — уже заявлен. */
    enterRace: (accessToken: string, raceId: string) =>
      postAuthorized(accessToken, `/v1/races/${encodeURIComponent(raceId)}/entry`, MyRaceEntry, {}),
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
} from './admin.ts';
