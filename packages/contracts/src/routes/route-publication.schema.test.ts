import { describe, expect, it } from 'vitest';

import {
  MyRoutePublication,
  ROUTE_PUBLICATION_COMMENT_MAX,
  ROUTE_PUBLICATION_LIMITS,
  ROUTE_PUBLICATION_MAX_PENDING,
  ROUTE_PUBLICATION_MAX_SUBMISSIONS,
  ROUTE_PUBLICATION_STATUSES,
  ROUTE_REJECTION_REASONS,
  ROUTE_STATE_REASONS,
  RoutePublicationLimitDetails,
  RouteRejectionReason,
  RouteStateDetails,
  SubmitRoutePublicationInput,
} from './route-publication.schema.ts';

const codesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('справочники публикации (routes-06)', () => {
  it('порядок зафиксирован (только в конец), лимиты U8', () => {
    expect(ROUTE_PUBLICATION_STATUSES).toEqual(['pending', 'approved', 'rejected', 'hidden']);
    expect(ROUTE_REJECTION_REASONS).toEqual([
      'dangerous',
      'impassable',
      'duplicate',
      'bad_title',
      'not_cycling',
      'other',
    ]);
    expect(ROUTE_STATE_REASONS).toEqual([
      'not_ready',
      'in_review',
      'published',
      'hidden',
      'own_route',
      'team_route',
    ]);
    expect(ROUTE_PUBLICATION_LIMITS).toEqual(['pending', 'route_submissions']);
    expect(ROUTE_PUBLICATION_COMMENT_MAX).toBe(500);
    expect(ROUTE_PUBLICATION_MAX_PENDING).toBe(3);
    expect(ROUTE_PUBLICATION_MAX_SUBMISSIONS).toBe(3);
    expect(RouteRejectionReason.safeParse('boring').success).toBe(false);
  });
});

describe('SubmitRoutePublicationInput', () => {
  it('город, покрытие и галочка имени; лишний ключ, пустое покрытие, без галочки — ошибка', () => {
    const body = { city: 'minsk', surfaces: ['asphalt', 'gravel'], showAuthorName: false };
    expect(SubmitRoutePublicationInput.parse(body)).toEqual(body);
    expect(SubmitRoutePublicationInput.safeParse({ ...body, status: 'approved' }).success).toBe(
      false,
    );
    expect(codesOf(SubmitRoutePublicationInput.safeParse({ ...body, surfaces: [] }))).toEqual([
      'REQUIRED',
    ]);
    expect(SubmitRoutePublicationInput.safeParse({ ...body, city: 'moscow' }).success).toBe(false);
    expect(
      SubmitRoutePublicationInput.safeParse({ city: 'minsk', surfaces: ['asphalt'] }).success,
    ).toBe(false);
    expect(SubmitRoutePublicationInput.safeParse({ ...body, showAuthorName: 'yes' }).success).toBe(
      false,
    );
  });
});

describe('ответы приложения', () => {
  it('MyRoutePublication: незнакомые коды — unknown; заявка без решения', () => {
    const pending = {
      status: 'pending',
      city: 'brest',
      surfaces: ['gravel'],
      showAuthorName: false,
      submittedAt: '2026-10-27T10:00:00.000Z',
      decidedAt: null,
      rejection: null,
    };
    expect(MyRoutePublication.parse(pending)).toEqual(pending);
    expect(MyRoutePublication.parse({ ...pending, status: 'archived' }).status).toBe('unknown');
  });

  it('details 409: причина состояния и лимит — tolerantEnum', () => {
    expect(RouteStateDetails.parse({ reason: 'in_review' })).toEqual({ reason: 'in_review' });
    expect(RouteStateDetails.parse({ reason: 'frozen' })).toEqual({ reason: 'unknown' });
    expect(RoutePublicationLimitDetails.parse({ limit: 'pending', max: 3 })).toEqual({
      limit: 'pending',
      max: 3,
    });
    expect(RoutePublicationLimitDetails.parse({ limit: 'daily', max: 10 }).limit).toBe('unknown');
  });
});
