import { describe, expect, it } from 'vitest';

import {
  CreateRideReportRequest,
  RIDE_REPORT_COMMENT_MAX,
  RIDE_REPORT_REASONS,
} from './ride-report.schema.ts';

const codesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('RIDE_REPORT_REASONS', () => {
  it('порядок зафиксирован (только в конец)', () => {
    expect(RIDE_REPORT_REASONS).toEqual(['spam', 'offensive', 'dangerous', 'fake', 'other']);
    expect(RIDE_REPORT_COMMENT_MAX).toBe(500);
  });
});

describe('CreateRideReportRequest', () => {
  it('причина без комментария; пустой комментарий — null; обрезка', () => {
    expect(CreateRideReportRequest.parse({ reason: 'spam' })).toEqual({ reason: 'spam' });
    expect(CreateRideReportRequest.parse({ reason: 'other', comment: '   ' })).toEqual({
      reason: 'other',
      comment: null,
    });
    expect(
      CreateRideReportRequest.parse({ reason: 'fake', comment: ' Такого места нет\nвообще ' }),
    ).toEqual({ reason: 'fake', comment: 'Такого места нет\nвообще' });
    expect(CreateRideReportRequest.parse({ reason: 'fake', comment: null }).comment).toBeNull();
  });

  it('причина вне справочника или без неё — REQUIRED', () => {
    expect(codesOf(CreateRideReportRequest.safeParse({ reason: 'boring' }))).toEqual(['REQUIRED']);
    expect(codesOf(CreateRideReportRequest.safeParse({}))).toEqual(['REQUIRED']);
  });

  it('комментарий ≤ 500, без управляющих символов; лишний ключ — ошибка', () => {
    expect(
      CreateRideReportRequest.safeParse({ reason: 'spam', comment: 'a'.repeat(500) }).success,
    ).toBe(true);
    expect(
      codesOf(CreateRideReportRequest.safeParse({ reason: 'spam', comment: 'a'.repeat(501) })),
    ).toEqual(['TOO_LONG']);
    expect(
      codesOf(CreateRideReportRequest.safeParse({ reason: 'spam', comment: 'a\u0007b' })),
    ).toEqual(['INVALID']);
    expect(CreateRideReportRequest.safeParse({ reason: 'spam', reporterUserId: 'x' }).success).toBe(
      false,
    );
  });
});
