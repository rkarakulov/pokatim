import {
  type InvitationAcceptRequest,
  type InviteRequest,
  PanelInvitation,
  PanelInvitationList,
  AccountErasurePage,
  type AccountErasureQuery,
  RetryAccountErasureResult,
  type RetryAccountErasureRequest,
  ApiError,
  type CheckInRequest,
  CheckInView,
  EventTicketingSettings,
  type EventTicketingUpdate,
  EventMaterialAdmin,
  type EventMaterialInput,
  EventMaterialsAdmin,
  type EventMaterialUploadQuery,
  type ReorderEventMaterialsRequest,
  type UpdateEventMaterialRequest,
  EventTicketsPage,
  type EventTicketsQuery,
  type TicketEventKind,
  PanelSeasonStandingsSummary,
  PanelSeasonStandingsTable,
  type SeasonStandingsTableQuery,
  AuditPage,
  PanelOverview,
  type CalendarStartInput,
  type CancelRaceRequest,
  type DiscardRaceRequest,
  PanelCalendarPage,
  type PanelCalendarQuery,
  PanelCalendarStart,
  PanelRace,
  PanelRacePage,
  type PanelRaceQuery,
  PanelProtocolRecalculations,
  PanelRaceAttempt,
  PanelRaceAttemptPage,
  type PanelRaceAttemptQuery,
  PanelRaceResults,
  PanelRaceStandings,
  type PanelRaceStandingsQuery,
  PanelVerifiedDemographics,
  type UpdateVerifiedDemographicsRequest,
  VerifiedDemographicsResult,
  type ProtocolEntryActionRequest,
  type ResultsActionRequest,
  PanelRoute,
  PanelRoutePage,
  type PanelRouteQuery,
  type PublishRouteInput,
  PanelSeason,
  PanelSeasonList,
  type PublishRaceRequest,
  type RaceInput,
  type RepublishCalendarStartRequest,
  type SeasonInput,
  type UnpublishCalendarStartRequest,
  type UpdateCalendarStartRequest,
  type UpdateRaceRequest,
  type UpdateSeasonRequest,
  type AuditQuery,
  type ChangeRoleRequest,
  type GrantRoleRequest,
  HealthResponse,
  PanelMe,
  PanelMember,
  PanelMemberList,
  type PanelSignInRequest,
  PanelSignInResponse,
  type ResendVerificationRequest,
  ResendVerificationResponse,
  type RevokeRoleRequest,
  type DismissRideReportsRequest,
  type HideRideRequest,
  ModerationRideDetail,
  ModerationRidePage,
  type ModerationRideQuery,
  type ApproveRiderRouteRequest,
  type DismissRiderRouteReportsRequest,
  type HideRiderRouteRequest,
  type RejectRiderRouteRequest,
  type RestoreRiderRouteRequest,
  RiderRouteModerationDetail,
  RiderRouteModerationPage,
  type RiderRouteModerationQuery,
  type RestoreRideRequest,
  type DisputeDecisionRequest,
  PanelDispute,
  PanelDisputeSeries,
  PanelDisputePage,
  type PanelDisputeQuery,
  type ResetRiderNameRequest,
  RiderNameResetResult,
  type DismissRiderProfileReportsRequest,
  RiderProfileModerationDetail,
  RiderProfileModerationPage,
  type RiderProfileModerationQuery,
  RiderProfileReportsDismissResult,
  type RiderProfileResetRequest,
  RiderProfileResetResult,
  RiderAvatarUnblockResult,
  type UnblockRiderAvatarRequest,
  PanelAppearance,
  type UpdateAppearanceRequest,
  PanelSignedIn,
  PanelSignedInWithRecoveryCodes,
  type TotpCodeRequest,
  type TotpDisableRequest,
  TotpRecoveryCodes,
  type TotpResetRequest,
  TotpSetup,
  type TotpSetupConfirmRequest,
  type TotpSignInRequest,
  TotpStatus,
} from '@pokatim/contracts';
import { createHttpClient } from '@rkarakulov/api-client-core';
import { z } from 'zod';

export interface AdminApiClientOptions {
  /** Тот же origin, что у панели (`''`): dev — прокси Vite, стенд и прод — `/admin/` того же домена. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** Параметры журнала до схемы: `limit` — число, остальные — строки; пустые не уходят в query. */
export type AuditListParams = Partial<z.input<typeof AuditQuery>>;

/** Параметры списка гонок панели до схемы. */
export type PanelRaceListParams = Partial<
  Omit<PanelRaceQuery, 'limit' | 'mine'> & { limit: number; mine: boolean }
>;
/** Параметры списка маршрутов панели до схемы. */
export type PanelRouteListParams = Partial<PanelRouteQuery>;
/** Параметры списка календаря панели до схемы. */
export type PanelCalendarListParams = Partial<PanelCalendarQuery>;
/** Параметры очереди модерации райдов до схемы. */
export type ModerationRideListParams = Partial<ModerationRideQuery>;
/** Параметры очереди модерации маршрутов райдеров до схемы (routes-06). */
export type RiderRouteListParams = Partial<RiderRouteModerationQuery>;
/** Параметры очереди модерации профилей райдеров до схемы (profile-moderation). */
export type RiderProfileListParams = Partial<RiderProfileModerationQuery>;
/** Параметры списка сбоев удаления аккаунтов до схемы (erasure-failures). */
export type AccountErasureListParams = Partial<AccountErasureQuery>;
/** Параметры списка споров панели до схемы. */
export type PanelDisputeListParams = Partial<PanelDisputeQuery>;
/** Таблица рейтинга сезона (race-results-08): класс и группа обязательны, `limit`/`cursor` — по желанию. */
export type SeasonStandingsTableParams = Pick<SeasonStandingsTableQuery, 'bikeClass' | 'group'> &
  Partial<Pick<SeasonStandingsTableQuery, 'limit' | 'cursor'>>;

/** Query-строка: пустые значения не уходят, массив — повтором ключа (`k=a&k=b`). */
export function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) for (const item of value) search.append(key, String(item));
    else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Клиент панели «Протокол» (ADR-0009): сессия — только httpOnly cookie панели (`credentials: 'same-origin'`), без
 * `Authorization` и без токенов в JS. Каждый ответ валидируется схемой контракта. Клиент приложения не меняется.
 */
export function createAdminApiClient({ baseUrl, fetchImpl }: AdminApiClientOptions) {
  // без getAccessToken: базовый клиент не добавит Authorization
  const { request } = createHttpClient({ baseUrl, fetchImpl, errorSchema: ApiError });
  const get = <S extends z.ZodType>(path: string, schema: S) =>
    request(path, schema, { method: 'GET', credentials: 'same-origin' });
  const post = <S extends z.ZodType>(path: string, schema: S, body: unknown = {}) =>
    request(path, schema, {
      method: 'POST',
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  const put = <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
    request(path, schema, {
      method: 'PUT',
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  const patch = <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
    request(path, schema, {
      method: 'PATCH',
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  const member = (userId: string) => `/v1/admin/members/${encodeURIComponent(userId)}`;
  const season = (id: string) => `/v1/admin/seasons/${encodeURIComponent(id)}`;
  const race = (id: string) => `/v1/admin/races/${encodeURIComponent(id)}`;
  const calendar = (id: string) => `/v1/admin/calendar/${encodeURIComponent(id)}`;
  const route = (id: string) => `/v1/admin/routes/${encodeURIComponent(id)}`;
  const moderationRide = (id: string) => `/v1/admin/rides/${encodeURIComponent(id)}`;
  const riderRoute = (id: string) => `/v1/admin/rider-routes/${encodeURIComponent(id)}`;
  const riderProfile = (userId: string) => `/v1/admin/rider-profiles/${encodeURIComponent(userId)}`;
  const dispute = (id: string) => `/v1/admin/disputes/${encodeURIComponent(id)}`;
  const adminEvent = (kind: TicketEventKind, eventId: string) =>
    `/v1/admin/events/${encodeURIComponent(kind)}/${encodeURIComponent(eventId)}`;

  return {
    /** Статус API (экран «Обзор»). */
    health: () => get('/v1/health', HealthResponse),
    /** «Обзор» (admin-overview): блоки по правам сотрудника — нет права, нет поля. */
    overview: () => get('/v1/admin/overview', PanelOverview),
    /** Вход тем же e-mail и паролем, что в приложении: cookie панели или `verificationRequired`. */
    signIn: (body: PanelSignInRequest) =>
      post('/v1/admin/session/sign-in', PanelSignInResponse, body),
    /** Второй шаг входа (ADR-0024): код TOTP или код восстановления по вызову; «запомнить устройство» — cookie. */
    signInTotp: (body: z.input<typeof TotpSignInRequest>) =>
      post('/v1/admin/session/sign-in/totp', PanelSignedIn, body),
    /** Подключение 2FA на экране входа (`totpSetupRequired`): секрет и otpauth — один раз. */
    signInTotpSetup: (challenge: string) =>
      post('/v1/admin/session/sign-in/totp-setup', TotpSetup, { challenge }),
    signInTotpSetupConfirm: (body: z.input<typeof TotpSetupConfirmRequest>) =>
      post('/v1/admin/session/sign-in/totp-setup/confirm', PanelSignedInWithRecoveryCodes, body),
    /** Выход: сессия панели отзывается, cookie сбрасывается; 204. */
    signOut: () => post('/v1/admin/session/sign-out', z.undefined()),
    /** «Кто я и что могу»: 401 — сессии нет. */
    me: () => get('/v1/admin/session/me', PanelMe),
    /** Повтор письма подтверждения — существующий эндпоинт identity (тот же, что у приложения). */
    resendVerification: (body: ResendVerificationRequest) =>
      post('/v1/auth/verification/resend', ResendVerificationResponse, body),
    listMembers: () => get('/v1/admin/members', PanelMemberList),
    grantRole: (body: GrantRoleRequest) => post('/v1/admin/members', PanelMember, body),
    changeRole: (userId: string, body: ChangeRoleRequest) =>
      post(`${member(userId)}/role`, PanelMember, body),
    revokeRole: (userId: string, body: RevokeRoleRequest) =>
      post(`${member(userId)}/revoke`, PanelMember, body),
    /** Сброс 2FA сотрудника (`members.manage`, причина обязательна): 204. */
    resetMemberTotp: (userId: string, body: TotpResetRequest) =>
      post(`${member(userId)}/totp/reset`, z.undefined(), body),

    // --- приглашения в команду (ADR-0026) ---
    /** Живые приглашения (`members.read`): `pending`, в т. ч. истёкшие (`expired` — от сервера). */
    listInvitations: () => get('/v1/admin/invitations', PanelInvitationList),
    /** Пригласить адрес (`members.manage`); повтор на тот же адрес заменяет прежнее — «Отправить повторно». */
    invite: (body: InviteRequest) => post('/v1/admin/invitations', PanelInvitation, body),
    /** Отозвать приглашение (`members.manage`): 204. */
    revokeInvitation: (id: string) =>
      post(`/v1/admin/invitations/${encodeURIComponent(id)}/revoke`, z.undefined()),
    /** Принять приглашение паролем (без сессии): ответ — как у входа (cookie панели, шаги 2FA). */
    acceptInvitation: (body: InvitationAcceptRequest) =>
      post('/v1/admin/invitations/accept', PanelSignInResponse, body),

    // --- 2FA своего аккаунта (любая роль, ADR-0024) ---
    getTotpStatus: () => get('/v1/admin/account/totp', TotpStatus),
    startTotpSetup: () => post('/v1/admin/account/totp/setup', TotpSetup),
    confirmTotpSetup: (body: TotpCodeRequest) =>
      post('/v1/admin/account/totp/confirm', TotpRecoveryCodes, body),
    regenerateRecoveryCodes: (body: TotpCodeRequest) =>
      post('/v1/admin/account/totp/recovery-codes', TotpRecoveryCodes, body),
    /** Отключение — с кодом TOTP или восстановления: 204. */
    disableTotp: (body: TotpDisableRequest) =>
      post('/v1/admin/account/totp/disable', z.undefined(), body),

    listAudit: (params: AuditListParams = {}) =>
      get(`/v1/admin/audit${queryString(params)}`, AuditPage),

    // --- сезоны (чтение — races.read, изменение — seasons.manage) ---
    listSeasons: () => get('/v1/admin/seasons', PanelSeasonList),
    createSeason: (body: SeasonInput) => post('/v1/admin/seasons', PanelSeason, body),
    updateSeason: (id: string, body: UpdateSeasonRequest) => post(season(id), PanelSeason, body),
    /** Рейтинг сезона (race-results-08, `races.read`): сводка с версией формулы и «ждёт пересчёта». */
    getSeasonStandings: (id: string) => get(`${season(id)}/standings`, PanelSeasonStandingsSummary),
    /** Таблица «класс × группа»; `userId` строки — только сотруднику, видящему все гонки. */
    getSeasonStandingsTable: (id: string, params: SeasonStandingsTableParams) =>
      get(`${season(id)}/standings/table${queryString(params)}`, PanelSeasonStandingsTable),

    // --- гонки (races.read / races.manage; чужие — races.manage_any, иначе 404) ---
    listRaces: (params: PanelRaceListParams = {}) =>
      get(`/v1/admin/races${queryString(params)}`, PanelRacePage),
    getRace: (id: string) => get(race(id), PanelRace),
    createRace: (body: RaceInput) => post('/v1/admin/races', PanelRace, body),
    updateRace: (id: string, body: UpdateRaceRequest) => post(race(id), PanelRace, body),
    publishRace: (id: string, body: PublishRaceRequest) =>
      post(`${race(id)}/publish`, PanelRace, body),
    cancelRace: (id: string, body: CancelRaceRequest) =>
      post(`${race(id)}/cancel`, PanelRace, body),
    /** Удаление черновика: 204. */
    discardRace: (id: string, body: DiscardRaceRequest) =>
      post(`${race(id)}/discard`, z.undefined(), body),

    // --- результаты гонки (чтение — races.read; чужая гонка организатора — 404) ---
    getRaceResultsSummary: (raceId: string) => get(`${race(raceId)}/results`, PanelRaceResults),
    listRaceAttempts: (raceId: string, params: Partial<PanelRaceAttemptQuery> = {}) =>
      get(`${race(raceId)}/attempts${queryString(params)}`, PanelRaceAttemptPage),
    /** Участники: `group`, `attention` и `finishers` (race-results-07) — фильтры. */
    getRaceStandings: (raceId: string, params: PanelRaceStandingsQuery = {}) =>
      get(`${race(raceId)}/standings${queryString(params)}`, PanelRaceStandings),
    listProtocolRecalculations: (raceId: string) =>
      get(`${race(raceId)}/protocol/recalculations`, PanelProtocolRecalculations),

    // --- протокол гонки (race-results-05): до публикации — results.manage, пересчёт после — results.revise ---
    excludeAttempt: (raceId: string, attemptId: string, body: ResultsActionRequest) =>
      post(
        `${race(raceId)}/attempts/${encodeURIComponent(attemptId)}/exclude`,
        PanelRaceAttempt,
        body,
      ),
    restoreAttempt: (raceId: string, attemptId: string, body: ResultsActionRequest) =>
      post(
        `${race(raceId)}/attempts/${encodeURIComponent(attemptId)}/restore`,
        PanelRaceAttempt,
        body,
      ),
    recheckRaceResults: (raceId: string, body: ResultsActionRequest) =>
      post(`${race(raceId)}/results/recheck`, PanelRaceResults, body),
    publishProtocol: (raceId: string, body: ResultsActionRequest) =>
      post(`${race(raceId)}/protocol`, PanelRaceResults, body),
    disqualifyResult: (raceId: string, body: ProtocolEntryActionRequest) =>
      post(`${race(raceId)}/protocol/disqualify`, PanelRaceResults, body),
    revokeDisqualification: (raceId: string, body: ProtocolEntryActionRequest) =>
      post(`${race(raceId)}/protocol/revoke-disqualification`, PanelRaceResults, body),
    recheckProtocol: (raceId: string, body: ResultsActionRequest) =>
      post(`${race(raceId)}/protocol/recheck`, PanelRaceResults, body),
    applyProtocolRecheck: (raceId: string, body: ResultsActionRequest) =>
      post(`${race(raceId)}/protocol/apply-recheck`, PanelRaceResults, body),

    // --- маршруты коридора (загрузка — races.manage, чтение — races.read) ---
    /**
     * Загрузка GPX маршрута сырыми байтами (`application/octet-stream`): `202` — в обработке (`processing`: новый или
     * повтор после отказа), `200` — тот же файл того же сотрудника как есть. Формат сервер определяет по содержимому.
     */
    uploadRoute: (body: Blob | Uint8Array, title: string) =>
      request(`/v1/admin/routes${queryString({ title })}`, PanelRoute, {
        method: 'POST',
        body: body as BodyInit,
        headers: { 'content-type': 'application/octet-stream' },
        credentials: 'same-origin',
      }),
    listRoutes: (params: PanelRouteListParams = {}) =>
      get(`/v1/admin/routes${queryString(params)}`, PanelRoutePage),
    getRoute: (id: string) => get(route(id), PanelRoute),
    /** Публикация в каталог или правка города и покрытия (routes-01); не готов — 409 `ROUTE_INVALID_STATE`. */
    publishRoute: (id: string, body: PublishRouteInput) =>
      post(`${route(id)}/publish`, PanelRoute, body),
    /** Снятие с публикации; неопубликованный — 200 без изменений. */
    unpublishRoute: (id: string) => post(`${route(id)}/unpublish`, PanelRoute),

    // --- календарь стартов (calendar.manage) ---
    listCalendar: (params: PanelCalendarListParams = {}) =>
      get(`/v1/admin/calendar${queryString(params)}`, PanelCalendarPage),
    getCalendarStart: (id: string) => get(calendar(id), PanelCalendarStart),
    createCalendarStart: (body: CalendarStartInput) =>
      post('/v1/admin/calendar', PanelCalendarStart, body),
    updateCalendarStart: (id: string, body: UpdateCalendarStartRequest) =>
      post(calendar(id), PanelCalendarStart, body),
    unpublishCalendarStart: (id: string, body: UnpublishCalendarStartRequest) =>
      post(`${calendar(id)}/unpublish`, PanelCalendarStart, body),
    republishCalendarStart: (id: string, body: RepublishCalendarStartRequest) =>
      post(`${calendar(id)}/republish`, PanelCalendarStart, body),

    // --- модерация кофе-райдов (rides.moderate, 05b) ---
    listModerationRides: (params: ModerationRideListParams = {}) =>
      get(`/v1/admin/rides${queryString(params)}`, ModerationRidePage),
    getModerationRide: (id: string) => get(moderationRide(id), ModerationRideDetail),
    hideRide: (id: string, body: HideRideRequest) =>
      post(`${moderationRide(id)}/hide`, ModerationRideDetail, body),
    restoreRide: (id: string, body: RestoreRideRequest) =>
      post(`${moderationRide(id)}/restore`, ModerationRideDetail, body),
    dismissRideReports: (id: string, body: DismissRideReportsRequest) =>
      post(`${moderationRide(id)}/dismiss-reports`, ModerationRideDetail, body),

    // --- модерация маршрутов райдеров (routes.moderate, routes-06): конфликт версии — 409 CONFLICT ---
    listRiderRoutes: (params: RiderRouteListParams = {}) =>
      get(`/v1/admin/rider-routes${queryString(params)}`, RiderRouteModerationPage),
    getRiderRoute: (id: string) => get(riderRoute(id), RiderRouteModerationDetail),
    approveRiderRoute: (id: string, body: ApproveRiderRouteRequest) =>
      post(`${riderRoute(id)}/approve`, RiderRouteModerationDetail, body),
    rejectRiderRoute: (id: string, body: RejectRiderRouteRequest) =>
      post(`${riderRoute(id)}/reject`, RiderRouteModerationDetail, body),
    hideRiderRoute: (id: string, body: HideRiderRouteRequest) =>
      post(`${riderRoute(id)}/hide`, RiderRouteModerationDetail, body),
    restoreRiderRoute: (id: string, body: RestoreRiderRouteRequest) =>
      post(`${riderRoute(id)}/restore`, RiderRouteModerationDetail, body),
    dismissRiderRouteReports: (id: string, body: DismissRiderRouteReportsRequest) =>
      post(`${riderRoute(id)}/dismiss-reports`, RiderRouteModerationDetail, body),

    // --- споры по результатам (disputes.read / disputes.decide, race-results-06) ---
    listDisputes: (params: PanelDisputeListParams = {}) =>
      get(`/v1/admin/disputes${queryString(params)}`, PanelDisputePage),
    getDispute: (id: string) => get(dispute(id), PanelDispute),
    decideDispute: (id: string, body: DisputeDecisionRequest) =>
      post(`${dispute(id)}/decision`, PanelDispute, body),
    /** Ряды пульса и мощности оспоренного результата (06b): `preparing` — опрашивать дальше. */
    getDisputeSeries: (id: string) => get(`${dispute(id)}/series`, PanelDisputeSeries),

    // --- профили райдеров (profiles.moderate, profile-02) ---
    resetRiderName: (userId: string, body: ResetRiderNameRequest) =>
      post(
        `/v1/admin/profiles/${encodeURIComponent(userId)}/name-reset`,
        RiderNameResetResult,
        body,
      ),
    // profile-moderation: очередь жалоб на профили, карточка, сбросы фото и клуба, «Отклонить жалобы»
    listRiderProfiles: (params: RiderProfileListParams = {}) =>
      get(`/v1/admin/rider-profiles${queryString(params)}`, RiderProfileModerationPage),
    getRiderProfile: (userId: string) => get(riderProfile(userId), RiderProfileModerationDetail),
    resetRiderAvatar: (userId: string, body: RiderProfileResetRequest) =>
      post(`${riderProfile(userId)}/avatar-reset`, RiderProfileResetResult, body),
    resetRiderClub: (userId: string, body: RiderProfileResetRequest) =>
      post(`${riderProfile(userId)}/club-reset`, RiderProfileResetResult, body),
    /** Устаревший `reportRevision` (пришла новая жалоба) — 409 `CONFLICT`. */
    dismissRiderProfileReports: (userId: string, body: DismissRiderProfileReportsRequest) =>
      post(`${riderProfile(userId)}/dismiss-reports`, RiderProfileReportsDismissResult, body),
    /** «Снять запрет» загрузки фото; запрета нет — `{ unblocked: false }` (profile-moderation-followups). */
    unblockRiderAvatar: (userId: string, body: UnblockRiderAvatarRequest) =>
      post(`${riderProfile(userId)}/avatar-unblock`, RiderAvatarUnblockResult, body),
    /** Адрес фото райдера для карточки (тот же origin, без запроса). */
    riderAvatarUrl: (id: string) => `${baseUrl}/v1/avatars/${encodeURIComponent(id)}`,
    // erasure-failures: зависшие удаления аккаунтов и повтор очистки (platform.stats, только admin)
    listAccountErasures: (params: AccountErasureListParams = {}) =>
      get(`/v1/admin/account-erasures${queryString(params)}`, AccountErasurePage),
    /** Нет удалённого аккаунта — 404; очистка завершена или не зависла — 409 `CONFLICT`. */
    retryAccountErasure: (userId: string, body: RetryAccountErasureRequest) =>
      post(
        `/v1/admin/account-erasures/${encodeURIComponent(userId)}/retry`,
        RetryAccountErasureResult,
        body,
      ),
    // race-results-07: пол и год анкеты Verified (profiles.verified_edit, только admin)
    getVerifiedDemographics: (userId: string) =>
      get(
        `/v1/admin/profiles/${encodeURIComponent(userId)}/verified-demographics`,
        PanelVerifiedDemographics,
      ),
    updateVerifiedDemographics: (userId: string, body: UpdateVerifiedDemographicsRequest) =>
      patch(
        `/v1/admin/profiles/${encodeURIComponent(userId)}/verified-demographics`,
        VerifiedDemographicsResult,
        body,
      ),

    // --- оформление приложения (appearance.manage): сезонный декор, настройка-синглтон, замена по `version` ---
    getAppearance: () => get('/v1/admin/appearance', PanelAppearance),
    /** Смена сезонного декора: устаревшая `version` — 409 `CONFLICT`. */
    updateAppearance: (body: UpdateAppearanceRequest) =>
      put('/v1/admin/appearance', PanelAppearance, body),

    // --- билеты (event-tickets): настройки — права по виду события, check-in и участники — tickets.checkin ---
    getEventTicketing: (kind: TicketEventKind, eventId: string) =>
      get(`${adminEvent(kind, eventId)}/ticketing`, EventTicketingSettings),
    /**
     * Настройки билетов: устаревшая `version` — 409 `CONFLICT`; `409 TICKETING_INVALID_STATE { reason }`; поля — 400.
     */
    updateEventTicketing: (kind: TicketEventKind, eventId: string, body: EventTicketingUpdate) =>
      put(`${adminEvent(kind, eventId)}/ticketing`, EventTicketingSettings, body),
    listEventTickets: (
      kind: TicketEventKind,
      eventId: string,
      params: Partial<EventTicketsQuery> = {},
    ) => get(`${adminEvent(kind, eventId)}/tickets${queryString(params)}`, EventTicketsPage),
    /** Проверка билета без отметки (QR или код); нет или чужое событие — 404. */
    lookupTicket: (body: CheckInRequest) => post('/v1/admin/tickets/lookup', CheckInView, body),
    /** Отметка участника: исход — `outcome` (повтор — `already_checked_in`). */
    checkInTicket: (body: CheckInRequest) => post('/v1/admin/tickets/check-in', CheckInView, body),

    // --- материалы события (event-tickets PR C): права — как у настроек билетов (по виду события) ---
    listEventMaterials: (kind: TicketEventKind, eventId: string) =>
      get(`${adminEvent(kind, eventId)}/materials`, EventMaterialsAdmin),
    /** Ссылка или текст; лимит — 409 `TICKETING_INVALID_STATE { reason: 'materials_limit' }`. */
    createEventMaterial: (kind: TicketEventKind, eventId: string, body: EventMaterialInput) =>
      post(`${adminEvent(kind, eventId)}/materials`, EventMaterialAdmin, body),
    /**
     * PDF сырыми байтами (`application/octet-stream`) — материал создаётся вместе с файлом. Не PDF — 415
     * `MATERIAL_FILE_UNSUPPORTED`, больше 10 МиБ — 413 `MATERIAL_FILE_TOO_LARGE`, лимиты — 409.
     */
    uploadEventMaterial: (
      kind: TicketEventKind,
      eventId: string,
      body: Blob | Uint8Array,
      query: EventMaterialUploadQuery,
    ) =>
      request(
        `${adminEvent(kind, eventId)}/materials/files${queryString(query)}`,
        EventMaterialAdmin,
        {
          method: 'POST',
          body: body as BodyInit,
          headers: { 'content-type': 'application/octet-stream' },
          credentials: 'same-origin',
        },
      ),
    /** Правка (файл не меняется): устаревшая `version` — 409 `CONFLICT`. */
    updateEventMaterial: (
      kind: TicketEventKind,
      eventId: string,
      id: string,
      body: UpdateEventMaterialRequest,
    ) =>
      patch(
        `${adminEvent(kind, eventId)}/materials/${encodeURIComponent(id)}`,
        EventMaterialAdmin,
        body,
      ),
    /** Удаление материала и его PDF: 204. */
    deleteEventMaterial: (kind: TicketEventKind, eventId: string, id: string) =>
      post(
        `${adminEvent(kind, eventId)}/materials/${encodeURIComponent(id)}/delete`,
        z.undefined(),
      ),
    /** Новый порядок — полный набор id (иначе 409 `CONFLICT`). */
    reorderEventMaterials: (
      kind: TicketEventKind,
      eventId: string,
      body: ReorderEventMaterialsRequest,
    ) => put(`${adminEvent(kind, eventId)}/materials/order`, EventMaterialsAdmin, body),
    /** Адрес PDF материала (публичный, скачивание). */
    eventFileUrl: (fileId: string) => `${baseUrl}/v1/event-files/${encodeURIComponent(fileId)}`,
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
