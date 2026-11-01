import { describe, expect, it } from 'vitest';

import {
  DismissRiderProfileReportsRequest,
  MODERATION_PROFILE_REPORTS_MAX,
  PROFILE_REPORT_RESOLUTIONS,
  RIDER_PROFILE_MODERATION_MAX_LIMIT,
  RiderProfileModerationDetail,
  RiderProfileModerationPage,
  RiderProfileModerationQuery,
  RiderProfileReportsDismissResult,
  RiderProfileResetRequest,
  RiderProfileResetResult,
  RiderAvatarUnblockResult,
  UnblockRiderAvatarRequest,
} from './profile-moderation.schema.ts';

const ID = '0192f3a0-0000-7000-8000-000000000001';
const TOKEN = 'a'.repeat(43);
const AT = '2026-10-28T08:00:00.000Z';

const report = {
  id: ID,
  reason: 'photo',
  comment: null,
  createdAt: AT,
  resolution: null,
  resolvedAt: null,
} as const;

const detail = {
  userId: ID,
  name: null,
  club: 'Клуб',
  avatar: { id: TOKEN },
  isPublic: false,
  openReportCount: 1,
  lastReportAt: AT,
  reportRevision: 3,
  reports: [report],
};

describe('модерация профилей райдеров (profile-moderation)', () => {
  it('константы: решения, предел жалоб карточки и страницы', () => {
    expect(PROFILE_REPORT_RESOLUTIONS).toEqual(['actioned', 'dismissed']);
    expect(MODERATION_PROFILE_REPORTS_MAX).toBe(100);
    expect(RIDER_PROFILE_MODERATION_MAX_LIMIT).toBe(50);
  });

  it('RiderProfileModerationQuery: limit 20 по умолчанию, 1–50; лишний ключ — ошибка', () => {
    expect(RiderProfileModerationQuery.parse({})).toEqual({ limit: 20 });
    expect(RiderProfileModerationQuery.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    expect(RiderProfileModerationQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(RiderProfileModerationQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(RiderProfileModerationQuery.safeParse({ state: 'x' }).success).toBe(false);
  });

  it('RiderProfileModerationQuery: reason — строгий enum причины жалобы', () => {
    expect(RiderProfileModerationQuery.parse({ reason: 'name' })).toEqual({
      limit: 20,
      reason: 'name',
    });
    expect(RiderProfileModerationQuery.safeParse({ reason: 'bad' }).success).toBe(false);
  });

  it('RiderProfileModerationPage: строка очереди, причина — строгий enum', () => {
    const row = {
      userId: ID,
      name: 'Аня',
      openReportCount: 2,
      topReason: 'club',
      lastReportAt: AT,
      hasAvatar: true,
      hasClub: false,
    };
    expect(RiderProfileModerationPage.parse({ items: [row], nextCursor: null }).items).toEqual([
      { ...row, openReasons: [] },
    ]);
    expect(
      RiderProfileModerationPage.parse({
        items: [{ ...row, openReasons: ['photo', 'name'] }],
        nextCursor: null,
      }).items[0]?.openReasons,
    ).toEqual(['photo', 'name']);
    expect(
      RiderProfileModerationPage.safeParse({
        items: [{ ...row, topReason: 'future' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it('RiderProfileModerationDetail: жалобы без автора, ≤ 100, строгое решение', () => {
    const parsed = RiderProfileModerationDetail.parse(detail);
    expect(Object.keys(parsed.reports[0] ?? {})).not.toContain('reporterUserId');
    expect(
      RiderProfileModerationDetail.safeParse({
        ...detail,
        reports: Array.from({ length: 101 }, () => report),
      }).success,
    ).toBe(false);
    expect(
      RiderProfileModerationDetail.safeParse({
        ...detail,
        reports: [{ ...report, resolution: 'hidden' }],
      }).success,
    ).toBe(false);
    expect(RiderProfileModerationDetail.safeParse({ ...detail, reportRevision: -1 }).success).toBe(
      false,
    );
    expect(RiderProfileModerationDetail.safeParse({ ...detail, avatar: null }).success).toBe(true);
  });

  it('RiderProfileModerationDetail: запрет загрузки фото и счётчик сбросов — умолчания', () => {
    expect(RiderProfileModerationDetail.parse(detail)).toMatchObject({
      avatarUploadBlockedUntil: null,
      avatarResetCount: 0,
    });
    expect(
      RiderProfileModerationDetail.parse({
        ...detail,
        avatarUploadBlockedUntil: AT,
        avatarResetCount: 3,
      }),
    ).toMatchObject({ avatarUploadBlockedUntil: AT, avatarResetCount: 3 });
    expect(
      RiderProfileModerationDetail.safeParse({ ...detail, avatarResetCount: -1 }).success,
    ).toBe(false);
  });

  it('«Снять запрет»: тело — причина, ответ — { unblocked }', () => {
    expect(UnblockRiderAvatarRequest.parse({ reason: 'Ошибка модератора' })).toEqual({
      reason: 'Ошибка модератора',
    });
    expect(UnblockRiderAvatarRequest.safeParse({ reason: 'abc', extra: 1 }).success).toBe(false);
    expect(RiderAvatarUnblockResult.parse({ unblocked: false })).toEqual({ unblocked: false });
    expect(RiderAvatarUnblockResult.safeParse({}).success).toBe(false);
  });

  it('тела действий: сброс — код причины (текст — у «Другое»); «Отклонить жалобы» — причина 3–500 и reportRevision', () => {
    expect(RiderProfileResetRequest.parse({ reason: 'club' })).toEqual({ reason: 'club' });
    expect(RiderProfileResetRequest.parse({ reason: 'other', comment: 'Мат в клубе' })).toEqual({
      reason: 'other',
      comment: 'Мат в клубе',
    });
    expect(RiderProfileResetRequest.safeParse({ reason: 'other' }).success).toBe(false);
    expect(RiderProfileResetRequest.safeParse({ reason: 'photo', comment: 'Фото' }).success).toBe(
      false,
    );
    expect(RiderProfileResetRequest.safeParse({ reason: 'Мат в клубе' }).success).toBe(false);
    expect(RiderProfileResetRequest.safeParse({ reason: 'club', extra: 1 }).success).toBe(false);
    expect(
      DismissRiderProfileReportsRequest.parse({ reason: 'Всё в порядке', reportRevision: 0 }),
    ).toEqual({ reason: 'Всё в порядке', reportRevision: 0 });
    expect(DismissRiderProfileReportsRequest.safeParse({ reason: 'Всё в порядке' }).success).toBe(
      false,
    );
    expect(
      DismissRiderProfileReportsRequest.safeParse({ reason: 'Всё в порядке', reportRevision: -1 })
        .success,
    ).toBe(false);
  });

  it('ответы действий: { reset } и { dismissed }', () => {
    expect(RiderProfileResetResult.parse({ reset: false })).toEqual({ reset: false });
    expect(RiderProfileReportsDismissResult.parse({ dismissed: true })).toEqual({
      dismissed: true,
    });
    expect(RiderProfileReportsDismissResult.safeParse({}).success).toBe(false);
  });
});
