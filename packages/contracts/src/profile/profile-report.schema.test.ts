import { describe, expect, it } from 'vitest';

import {
  CreateProfileReportRequest,
  PROFILE_REPORT_COMMENT_MAX,
  PROFILE_REPORT_REASONS,
  PROFILE_STATE_REASONS,
  ProfileStateDetails,
  RiderProfileViewer,
} from './profile-report.schema.ts';

const codesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('жалоба на профиль райдера (profile-moderation)', () => {
  it('причины — в установленном порядке (только в конец); комментарий ≤ 500', () => {
    expect(PROFILE_REPORT_REASONS).toEqual([
      'photo',
      'club',
      'name',
      'impersonation',
      'spam',
      'other',
    ]);
    expect(PROFILE_REPORT_COMMENT_MAX).toBe(500);
  });

  it('CreateProfileReportRequest: пустой комментарий — null; > 500, управляющие, лишний ключ — ошибка', () => {
    expect(CreateProfileReportRequest.parse({ reason: 'photo' })).toEqual({ reason: 'photo' });
    expect(CreateProfileReportRequest.parse({ reason: 'other', comment: '  ' })).toEqual({
      reason: 'other',
      comment: null,
    });
    expect(CreateProfileReportRequest.parse({ reason: 'club', comment: ' Мат\nв клубе ' })).toEqual(
      { reason: 'club', comment: 'Мат\nв клубе' },
    );
    expect(codesOf(CreateProfileReportRequest.safeParse({ reason: 'boring' }))).toEqual([
      'REQUIRED',
    ]);
    expect(codesOf(CreateProfileReportRequest.safeParse({}))).toEqual(['REQUIRED']);
    expect(
      codesOf(CreateProfileReportRequest.safeParse({ reason: 'spam', comment: 'a'.repeat(501) })),
    ).toEqual(['TOO_LONG']);
    expect(
      CreateProfileReportRequest.safeParse({ reason: 'spam', comment: 'a'.repeat(500) }).success,
    ).toBe(true);
    expect(
      codesOf(CreateProfileReportRequest.safeParse({ reason: 'spam', comment: 'a\u0007b' })),
    ).toEqual(['INVALID']);
    expect(
      CreateProfileReportRequest.safeParse({ reason: 'spam', reporterUserId: 'x' }).success,
    ).toBe(false);
  });

  it('RiderProfileViewer: два флага', () => {
    expect(RiderProfileViewer.parse({ canReport: true, reported: false })).toEqual({
      canReport: true,
      reported: false,
    });
    expect(RiderProfileViewer.safeParse({ canReport: true }).success).toBe(false);
  });

  it('ProfileStateDetails: own_profile; неизвестная причина не ломает разбор (tolerant)', () => {
    expect(PROFILE_STATE_REASONS).toEqual(['own_profile', 'avatar_blocked']);
    expect(ProfileStateDetails.parse({ reason: 'own_profile' })).toEqual({
      reason: 'own_profile',
      until: null,
    });
    expect(ProfileStateDetails.safeParse({ reason: 'future_reason' }).success).toBe(true);
  });

  it('ProfileStateDetails: avatar_blocked с датой окончания запрета', () => {
    const until = '2026-11-29T10:00:00.000Z';
    expect(ProfileStateDetails.parse({ reason: 'avatar_blocked', until })).toEqual({
      reason: 'avatar_blocked',
      until,
    });
    expect(ProfileStateDetails.safeParse({ reason: 'avatar_blocked', until: 'x' }).success).toBe(
      false,
    );
  });
});
