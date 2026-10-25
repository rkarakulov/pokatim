import {
  ApiError,
  AuditPage,
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

function queryString(params: AuditListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
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
  const member = (userId: string) => `/v1/admin/members/${encodeURIComponent(userId)}`;

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
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
