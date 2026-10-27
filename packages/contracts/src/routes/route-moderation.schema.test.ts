import { describe, expect, it } from 'vitest';

import {
  ApproveRiderRouteRequest,
  DismissRiderRouteReportsRequest,
  HideRiderRouteRequest,
  MODERATION_ROUTE_REPORTS_MAX,
  RejectRiderRouteRequest,
  RestoreRiderRouteRequest,
  RIDER_ROUTE_MODERATION_STATES,
  RiderRouteModerationDetail,
  RiderRouteModerationPage,
  RiderRouteModerationQuery,
} from './route-moderation.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-27T10:00:00.000Z';

const row = {
  id: ID,
  title: 'Кольцо',
  authorUserId: ID,
  status: 'pending',
  city: 'minsk',
  surfaces: ['asphalt'],
  distanceM: 42_000,
  submittedAt: AT,
  openReportCount: 0,
  topReason: null,
  lastReportAt: null,
  hiddenAt: null,
};

const detail = {
  id: ID,
  title: 'Кольцо',
  authorUserId: ID,
  showAuthorName: true,
  status: 'approved',
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  submittedAt: AT,
  submissionCount: 1,
  decidedAt: AT,
  approvedAt: AT,
  rejection: null,
  hiddenAt: null,
  openReportCount: 1,
  lastReportAt: AT,
  version: 1,
  distanceM: 42_000,
  elevationGainM: null,
  isLoop: false,
  line: [
    [27.55, 53.9],
    [27.56, 53.91],
  ],
  elevation: null,
  reports: [
    {
      id: ID,
      reason: 'private_area',
      comment: null,
      createdAt: AT,
      resolution: null,
      resolvedAt: null,
    },
  ],
};

describe('модерация маршрутов райдеров (routes-06, панель — строгие enum)', () => {
  it('вкладки и запрос: по умолчанию pending и 20; лишний ключ, limit 51 — ошибка', () => {
    expect(RIDER_ROUTE_MODERATION_STATES).toEqual(['pending', 'reported', 'hidden']);
    expect(MODERATION_ROUTE_REPORTS_MAX).toBe(100);
    expect(RiderRouteModerationQuery.parse({})).toEqual({ state: 'pending', limit: 20 });
    expect(RiderRouteModerationQuery.parse({ state: 'hidden', limit: '50', cursor: 'c' })).toEqual({
      state: 'hidden',
      limit: 50,
      cursor: 'c',
    });
    for (const broken of [{ state: 'open' }, { limit: '51' }, { status: 'pending' }]) {
      expect(RiderRouteModerationQuery.safeParse(broken).success, JSON.stringify(broken)).toBe(
        false,
      );
    }
  });

  it('строка и карточка: без имени автора; неизвестный статус и причина — ошибка', () => {
    expect(RiderRouteModerationPage.parse({ items: [row], nextCursor: null }).items[0]).toEqual(
      row,
    );
    expect(RiderRouteModerationDetail.parse(detail)).toEqual(detail);
    expect(
      Object.keys(RiderRouteModerationDetail.parse({ ...detail, authorName: 'Аня' })),
    ).not.toContain('authorName');
    expect(RiderRouteModerationDetail.safeParse({ ...detail, status: 'withdrawn' }).success).toBe(
      false,
    );
    expect(
      RiderRouteModerationDetail.safeParse({
        ...detail,
        reports: [{ ...detail.reports[0], reason: 'boring' }],
      }).success,
    ).toBe(false);
    expect(
      RiderRouteModerationDetail.safeParse({
        ...detail,
        reports: Array.from({ length: 101 }, () => detail.reports[0]),
      }).success,
    ).toBe(false);
  });

  it('действия: версия, причины, комментарий ≤ 500; лишний ключ — ошибка', () => {
    expect(
      ApproveRiderRouteRequest.parse({ version: 0, city: 'brest', surfaces: ['gravel'] }),
    ).toEqual({ version: 0, city: 'brest', surfaces: ['gravel'] });
    expect(
      ApproveRiderRouteRequest.safeParse({ version: 0, city: 'brest', surfaces: [] }).success,
    ).toBe(false);
    expect(RejectRiderRouteRequest.parse({ version: 1, reason: 'duplicate' })).toEqual({
      version: 1,
      reason: 'duplicate',
    });
    expect(
      RejectRiderRouteRequest.parse({ version: 1, reason: 'other', comment: '  ' }).comment,
    ).toBeNull();
    expect(
      RejectRiderRouteRequest.safeParse({ version: 1, reason: 'other', comment: 'a'.repeat(501) })
        .success,
    ).toBe(false);
    expect(RejectRiderRouteRequest.safeParse({ version: 1, reason: 'spam' }).success).toBe(false);
    for (const schema of [HideRiderRouteRequest, RestoreRiderRouteRequest]) {
      expect(schema.parse({ version: 2, reason: 'Жалобы подтвердились' })).toEqual({
        version: 2,
        reason: 'Жалобы подтвердились',
      });
      expect(schema.safeParse({ version: 2, reason: 'ok' }).success).toBe(false);
      expect(schema.safeParse({ version: 2, reason: 'Причина', extra: 1 }).success).toBe(false);
    }
    expect(
      DismissRiderRouteReportsRequest.parse({ version: 1, reason: 'Ложные', lastReportAt: AT }),
    ).toEqual({ version: 1, reason: 'Ложные', lastReportAt: AT });
    expect(
      DismissRiderRouteReportsRequest.safeParse({ version: 1, reason: 'Ложные' }).success,
    ).toBe(false);
  });
});
