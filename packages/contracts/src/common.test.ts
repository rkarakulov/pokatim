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

describe('коды ошибок', () => {
  it('панель (admin-01): коды — в конце списка, после INVALID_CREDENTIALS (установленные клиенты)', () => {
    expect(ErrorCode.options.slice(-6)).toEqual([
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
