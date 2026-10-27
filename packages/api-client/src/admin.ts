import {
  ApiError,
  AuditPage,
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
  type RestoreRideRequest,
  type DisputeDecisionRequest,
  PanelDispute,
  PanelDisputeSeries,
  PanelDisputePage,
  type PanelDisputeQuery,
  type ResetRiderNameRequest,
  RiderNameResetResult,
  PanelAppearance,
  type UpdateAppearanceRequest,
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
/** Параметры списка споров панели до схемы. */
export type PanelDisputeListParams = Partial<PanelDisputeQuery>;

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
  const dispute = (id: string) => `/v1/admin/disputes/${encodeURIComponent(id)}`;

  return {
    /** Статус API (экран «Обзор»). */
    health: () => get('/v1/health', HealthResponse),
    /** Вход тем же e-mail и паролем, что в приложении: cookie панели или `verificationRequired`. */
    signIn: (body: PanelSignInRequest) =>
      post('/v1/admin/session/sign-in', PanelSignInResponse, body),
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
    listAudit: (params: AuditListParams = {}) =>
      get(`/v1/admin/audit${queryString(params)}`, AuditPage),

    // --- сезоны (чтение — races.read, изменение — seasons.manage) ---
    listSeasons: () => get('/v1/admin/seasons', PanelSeasonList),
    createSeason: (body: SeasonInput) => post('/v1/admin/seasons', PanelSeason, body),
    updateSeason: (id: string, body: UpdateSeasonRequest) => post(season(id), PanelSeason, body),

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

    // --- оформление приложения (appearance.manage, app-themes): настройка-синглтон, замена по `version` ---
    getAppearance: () => get('/v1/admin/appearance', PanelAppearance),
    /** Смена темы приложения: устаревшая `version` — 409 `CONFLICT`. */
    updateAppearance: (body: UpdateAppearanceRequest) =>
      put('/v1/admin/appearance', PanelAppearance, body),
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
