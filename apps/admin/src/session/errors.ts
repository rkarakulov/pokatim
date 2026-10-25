import { ApiHttpError, apiErrorOf } from '@pokatim/api-client';

/** HTTP-статус ответа API (или `undefined` — ответа не было). */
export const httpStatus = (error: unknown): number | undefined =>
  error instanceof ApiHttpError ? error.status : undefined;

/** Сессии панели нет или она погашена (401 — одно тело на любой отказ гарда). */
export const isUnauthorized = (error: unknown) => httpStatus(error) === 401;

/** Права роли не позволяют (403) — «Нет доступа к разделу». */
export const isForbidden = (error: unknown) =>
  httpStatus(error) === 403 && apiErrorOf(error)?.code === 'FORBIDDEN';
