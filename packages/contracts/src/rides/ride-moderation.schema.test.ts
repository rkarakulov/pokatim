import { describe, expect, it } from 'vitest';

import {
  DismissRideReportsRequest,
  HideRideRequest,
  ModerationRideDetail,
  ModerationRidePage,
  ModerationRideQuery,
  RestoreRideRequest,
  RIDE_MODERATION_STATES,
} from './ride-moderation.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2027-06-14T07:00:00.000Z';

const codesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('ModerationRideQuery', () => {
  it('по умолчанию state=open, limit 20; строгий; limit 1–50', () => {
    expect(RIDE_MODERATION_STATES).toEqual(['open', 'hidden']);
    expect(ModerationRideQuery.parse({})).toEqual({ state: 'open', limit: 20 });
    expect(ModerationRideQuery.parse({ state: 'hidden', limit: '50', cursor: 'c' })).toEqual({
      state: 'hidden',
      limit: 50,
      cursor: 'c',
    });
    expect(ModerationRideQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(ModerationRideQuery.safeParse({ state: 'all' }).success).toBe(false);
    expect(ModerationRideQuery.safeParse({ 'state[$ne]': 'x' }).success).toBe(false);
  });
});

describe('запросы действий модерации', () => {
  it('version и причина 3–500; лишний ключ — ошибка', () => {
    expect(HideRideRequest.parse({ version: 2, reason: ' Спам ' })).toEqual({
      version: 2,
      reason: 'Спам',
    });
    expect(codesOf(RestoreRideRequest.safeParse({ version: 2, reason: 'ab' }))).toEqual([
      'TOO_SHORT',
    ]);
    expect(HideRideRequest.safeParse({ version: 2, reason: 'Спам', status: 'x' }).success).toBe(
      false,
    );
    expect(HideRideRequest.safeParse({ version: -1, reason: 'Спам' }).success).toBe(false);
  });

  it('«Отклонить жалобы» несёт lastReportAt', () => {
    expect(
      DismissRideReportsRequest.parse({ version: 0, reason: 'Нарушений нет', lastReportAt: AT }),
    ).toEqual({ version: 0, reason: 'Нарушений нет', lastReportAt: AT });
    expect(
      DismissRideReportsRequest.safeParse({ version: 0, reason: 'Нарушений нет' }).success,
    ).toBe(false);
  });
});

describe('ответы модерации', () => {
  const row = {
    id: ID,
    title: 'Кофе-райд',
    city: 'minsk',
    startsAt: AT,
    status: 'published',
    phase: 'upcoming',
    openReportCount: 2,
    topReason: 'spam',
    lastReportAt: AT,
    hiddenAt: null,
  };

  it('страница очереди', () => {
    expect(ModerationRidePage.parse({ items: [row], nextCursor: null })).toEqual({
      items: [row],
      nextCursor: null,
    });
    expect(
      ModerationRidePage.safeParse({ items: [{ ...row, status: 'deleted' }], nextCursor: null })
        .success,
    ).toBe(false);
  });

  it('карточка без автора жалобы и id организатора', () => {
    const detail = ModerationRideDetail.parse({
      id: ID,
      title: 'Кофе-райд',
      organizerName: null,
      organizerUserId: ID,
      startsAt: AT,
      city: 'minsk',
      place: 'Парк',
      distanceKm: 40,
      paceMinKmh: 22,
      paceMaxKmh: 25,
      limit: null,
      goingCount: 3,
      description: null,
      status: 'hidden',
      phase: 'hidden',
      cancelReason: null,
      rescheduledAt: null,
      hiddenAt: AT,
      openReportCount: 0,
      lastReportAt: AT,
      version: 4,
      reports: [
        {
          id: ID,
          reason: 'offensive',
          comment: 'Мат в описании',
          createdAt: AT,
          resolution: 'hidden',
          resolvedAt: AT,
          reporterUserId: ID,
        },
      ],
    });
    expect(detail).not.toHaveProperty('organizerUserId');
    expect(detail.reports[0]).not.toHaveProperty('reporterUserId');
    expect(detail.reports[0]?.resolution).toBe('hidden');
  });
});
