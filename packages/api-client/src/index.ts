import {
  ApiError,
  CalendarCities,
  CalendarPage,
  type CalendarQuery,
  CalendarStartDetail,
  CurrentSeasonResponse,
  RaceDetail,
  RacePage,
  type RaceListQuery,
  SeasonCard,
  SeasonList,
  type SeasonRaceListQuery,
  ConfirmPasswordResetResponse,
  ConfirmVerificationResponse,
  type ErrorCode,
  HealthResponse,
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
  TrackUpload,
  TrackUploadPage,
  ConnectDeviceResponse,
  DeviceList,
  type CompleteDeviceRequest,
  type CompleteDevicesStepRequest,
  type ConnectDeviceRequest,
  type DeviceProvider,
  type DisconnectDeviceRequest,
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
    /** Сезон, в который попадает «сейчас», или `null`. */
    getCurrentSeason: () => getPublic('/v1/seasons/current', CurrentSeasonResponse),
    /** Все сезоны, новые сверху. */
    listSeasons: () => getPublic('/v1/seasons', SeasonList),
    /** Сезон по id; неизвестный — 404. */
    getSeason: (id: string) => getPublic(`/v1/seasons/${encodeURIComponent(id)}`, SeasonCard),
    /** Опубликованные и отменённые гонки сезона по концу окна; неизвестный сезон — 404. */
    listSeasonRaces: (id: string, params: SeasonRaceListParams = {}) =>
      getPublic(`/v1/seasons/${encodeURIComponent(id)}/races${queryString(params)}`, RacePage),
    /** Опубликованные старты с `from` (по умолчанию — сегодня по Минску). */
    listCalendar: (params: CalendarListParams = {}) =>
      getPublic(`/v1/calendar${queryString(params)}`, CalendarPage),
    getCalendarStart: (id: string) =>
      getPublic(`/v1/calendar/${encodeURIComponent(id)}`, CalendarStartDetail),
    listCalendarCities: () => getPublic('/v1/calendar/cities', CalendarCities),

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
