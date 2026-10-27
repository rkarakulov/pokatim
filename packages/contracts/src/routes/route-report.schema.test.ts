import { describe, expect, it } from 'vitest';

import {
  CatalogRouteViewer,
  CreateRouteReportRequest,
  ROUTE_REPORT_COMMENT_MAX,
  ROUTE_REPORT_REASONS,
} from './route-report.schema.ts';

const codesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('жалоба на маршрут райдера (routes-06)', () => {
  it('причины — в установленном порядке (только в конец); комментарий ≤ 500', () => {
    expect(ROUTE_REPORT_REASONS).toEqual([
      'dangerous',
      'impassable',
      'private_area',
      'offensive_title',
      'spam',
      'other',
    ]);
    expect(ROUTE_REPORT_COMMENT_MAX).toBe(500);
  });

  it('CreateRouteReportRequest: пустой комментарий — null; > 500, управляющие, лишний ключ — ошибка', () => {
    expect(CreateRouteReportRequest.parse({ reason: 'spam' })).toEqual({ reason: 'spam' });
    expect(CreateRouteReportRequest.parse({ reason: 'other', comment: '  ' })).toEqual({
      reason: 'other',
      comment: null,
    });
    expect(
      CreateRouteReportRequest.parse({ reason: 'private_area', comment: ' Забор\nдача ' }),
    ).toEqual({ reason: 'private_area', comment: 'Забор\nдача' });
    expect(codesOf(CreateRouteReportRequest.safeParse({ reason: 'boring' }))).toEqual(['REQUIRED']);
    expect(
      codesOf(CreateRouteReportRequest.safeParse({ reason: 'spam', comment: 'a'.repeat(501) })),
    ).toEqual(['TOO_LONG']);
    expect(
      CreateRouteReportRequest.safeParse({ reason: 'spam', comment: 'a'.repeat(500) }).success,
    ).toBe(true);
    expect(
      codesOf(CreateRouteReportRequest.safeParse({ reason: 'spam', comment: 'a\u0007b' })),
    ).toEqual(['INVALID']);
    expect(
      CreateRouteReportRequest.safeParse({ reason: 'spam', reporterUserId: 'x' }).success,
    ).toBe(false);
  });

  it('CatalogRouteViewer: два флага', () => {
    expect(CatalogRouteViewer.parse({ canReport: true, reported: false })).toEqual({
      canReport: true,
      reported: false,
    });
    expect(CatalogRouteViewer.safeParse({ canReport: true }).success).toBe(false);
  });
});
