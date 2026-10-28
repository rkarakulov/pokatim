import { describe, expect, it } from 'vitest';

import {
  ApiError,
  ErrorCode,
  FieldErrorCode,
  fieldError,
  RateLimitedDetails,
  ValidationErrorDetails,
} from './common.ts';
import { LinkExpiredDetails } from './auth/verification.schema.ts';
import { queryArray, tolerantEnum } from './common.ts';
import { z } from 'zod';

describe('коды ошибок', () => {
  it('панель (admin-01): коды — после INVALID_CREDENTIALS (установленные клиенты)', () => {
    const start = ErrorCode.options.indexOf('INVALID_CREDENTIALS');
    expect(ErrorCode.options.slice(start, start + 6)).toEqual([
      'INVALID_CREDENTIALS',
      'PANEL_ACCESS_DENIED',
      'PANEL_USER_UNVERIFIED',
      'PANEL_ALREADY_MEMBER',
      'PANEL_LAST_ADMIN',
      'PANEL_SELF_ACTION',
    ]);
  });

  it('содержат коды регистрации', () => {
    for (const code of ['EMAIL_TAKEN', 'EMAIL_UNAVAILABLE', 'LINK_EXPIRED'] as const) {
      expect(ErrorCode.parse(code)).toBe(code);
    }
    expect(ApiError.safeParse({ code: 'SOMETHING_NEW', message: 'x' }).success).toBe(false);
  });

  it('состав и порядок кодов прежние: коды базы, затем pokatim (установленные клиенты)', () => {
    expect(ErrorCode.options).toEqual([
      'VALIDATION_FAILED',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL',
      'EMAIL_TAKEN',
      'EMAIL_UNAVAILABLE',
      'LINK_EXPIRED',
      'INVALID_CREDENTIALS',
      'PANEL_ACCESS_DENIED',
      'PANEL_USER_UNVERIFIED',
      'PANEL_ALREADY_MEMBER',
      'PANEL_LAST_ADMIN',
      'PANEL_SELF_ACTION',
      'RACE_INVALID_STATE',
      'TRACK_FORMAT_UNSUPPORTED',
      'TRACK_TOO_LARGE',
      'TRACK_STORAGE_FULL',
      'DEVICE_PROVIDER_UNAVAILABLE',
      'DEVICE_LINK_INVALID',
      'DEVICE_PROVIDER_ERROR',
      'ROUTE_FORMAT_UNSUPPORTED',
      'ROUTE_TOO_LARGE',
      'RIDE_FULL',
      'RIDE_INVALID_STATE',
      'RIDE_QUOTA_EXCEEDED',
      'RACE_ENTRY_CLOSED',
      'RACE_ENTRY_WITHDRAWN',
      'RACE_ENTRY_REQUIRED',
      'RACE_WITHDRAW_CLOSED',
      'ATTEMPT_UPLOAD_CLOSED',
      'ATTEMPT_LIMIT',
      'ATTEMPT_SOURCE_INVALID',
      'RESULTS_ACTION_BLOCKED',
      'RESULTS_PUBLISH_BLOCKED',
      'DISPUTE_ACTION_BLOCKED',
      'DISPUTE_NOT_FOUND',
      'ROUTE_INVALID_STATE',
      'ROUTE_QUOTA_EXCEEDED',
      'PASSWORD_INCORRECT',
      'ACCOUNT_PANEL_MEMBER',
      'VERIFIED_PROFILE_REQUIRED',
      'RACE_TIER_LOCKED',
      'RESULT_GROUP_NOT_ALLOWED',
      'VERIFIED_DEMOGRAPHICS_LOCKED',
      'ROUTE_PUBLICATION_LIMIT',
      'AVATAR_FORMAT_UNSUPPORTED',
      'AVATAR_TOO_LARGE',
      'AVATAR_INVALID',
    ]);
    expect(FieldErrorCode.options).toEqual([
      'REQUIRED',
      'INVALID',
      'INVALID_EMAIL',
      'TOO_SHORT',
      'TOO_LONG',
      'INVALID_DATE',
      'AGE_BELOW_18',
      'CONSENT_REQUIRED',
      'SEASON_OVERLAP',
      'SEASON_IN_PAST',
      'SEASON_FINISHED',
      'SEASON_EXCLUDES_RACES',
      'DATE_ORDER',
      'WINDOW_IN_PAST',
      'OUTSIDE_SEASON',
      'PROTOCOL_TOO_EARLY',
      'PROTOCOL_ONLY_LATER',
      'FIELD_LOCKED',
      'ROUTE_NOT_READY',
      'RIDE_START_IN_PAST',
      'RIDE_START_TOO_FAR',
      'RIDE_PACE_ORDER',
      'RIDE_LIMIT_BELOW_GOING',
      'CORRIDOR_GATES_OVERLAP',
      'RIDE_ROUTE_UNAVAILABLE',
    ]);
  });

  it('fieldError — с кодами pokatim; undefined на входе — REQUIRED', () => {
    expect(fieldError('AGE_BELOW_18')({ input: '2020-01-01' })).toBe('AGE_BELOW_18');
    expect(fieldError('CONSENT_REQUIRED')({ input: undefined })).toBe('REQUIRED');
  });

  it('детали ошибок по кодам', () => {
    expect(
      ValidationErrorDetails.parse({ fields: [{ path: 'email', code: 'INVALID_EMAIL' }] }),
    ).toEqual({ fields: [{ path: 'email', code: 'INVALID_EMAIL' }] });
    expect(FieldErrorCode.safeParse('WHATEVER').success).toBe(false);
    expect(RateLimitedDetails.parse({ retryAfterSec: 42 })).toEqual({ retryAfterSec: 42 });
    expect(RateLimitedDetails.safeParse({ retryAfterSec: -1 }).success).toBe(false);
    expect(LinkExpiredDetails.parse({ email: 'rider@example.com' })).toEqual({
      email: 'rider@example.com',
    });
  });
});

describe('tolerantEnum (ответы приложения, R6)', () => {
  const Kind = tolerantEnum(['road', 'gravel'] as const);

  it('известное значение — как есть, незнакомое — unknown', () => {
    expect(Kind.parse('road')).toBe('road');
    expect(Kind.parse('cyclocross')).toBe('unknown');
    expect(z.array(Kind).parse(['gravel', 'track'])).toEqual(['gravel', 'unknown']);
  });

  it('не строка — ошибка', () => {
    expect(Kind.safeParse(1).success).toBe(false);
    expect(Kind.safeParse(null).success).toBe(false);
  });
});

describe('queryArray', () => {
  const Filter = queryArray(z.enum(['a', 'b']), 2);

  it('одна строка — массив; массив — как есть; длина ограничена', () => {
    expect(Filter.parse('a')).toEqual(['a']);
    expect(Filter.parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(Filter.safeParse(['a', 'b', 'a']).success).toBe(false);
    expect(Filter.safeParse({ $ne: 'a' }).success).toBe(false);
  });
});
