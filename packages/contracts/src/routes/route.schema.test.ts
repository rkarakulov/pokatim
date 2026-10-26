import { describe, expect, it } from 'vitest';

import {
  PanelRoute,
  PanelRoutePage,
  PanelRouteQuery,
  ROUTE_FAILURE_CODES,
  ROUTE_FILE_MAX_BYTES,
  ROUTE_STATUSES,
  UploadRouteQuery,
} from './route.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const route = {
  id: ID,
  title: 'Минское кольцо',
  status: 'ready',
  failure: null,
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  owner: { userId: ID, displayName: 'Ольга' },
  createdAt: '2026-10-27T10:00:00.000Z',
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
  ],
};

describe('маршрут', () => {
  it('справочники и лимит файла', () => {
    expect(ROUTE_STATUSES).toEqual(['processing', 'ready', 'failed']);
    expect(ROUTE_FAILURE_CODES).toEqual([
      'unreadable',
      'no_track',
      'too_many_points',
      'too_short',
      'too_long',
      'timeout',
    ]);
    expect(ROUTE_FILE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('PanelRoute: готовый и необработанный; линия ≤ 1000 точек; неизвестный статус — ошибка', () => {
    expect(PanelRoute.parse(route)).toEqual(route);
    const processing = {
      ...route,
      status: 'processing',
      distanceM: null,
      elevationGainM: null,
      isLoop: null,
      line: [],
    };
    expect(PanelRoute.parse(processing)).toEqual(processing);
    expect(PanelRoute.safeParse({ ...route, status: 'published' }).success).toBe(false);
    expect(PanelRoute.safeParse({ ...route, failure: 'storage' }).success).toBe(false);
    expect(
      PanelRoute.safeParse({ ...route, line: Array.from({ length: 1001 }, () => [27.5, 53.9]) })
        .success,
    ).toBe(false);
    const { line: _line, ...summary } = route;
    expect(PanelRoutePage.parse({ items: [summary], nextCursor: null }).items).toHaveLength(1);
  });

  it('PanelRouteQuery: limit по умолчанию 50, максимум 100; status — только ready; лишние ключи — ошибка', () => {
    expect(PanelRouteQuery.parse({})).toEqual({ limit: 50 });
    expect(PanelRouteQuery.parse({ status: 'ready', limit: '100' })).toEqual({
      status: 'ready',
      limit: 100,
    });
    expect(PanelRouteQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(PanelRouteQuery.safeParse({ status: 'failed' }).success).toBe(false);
    expect(PanelRouteQuery.safeParse({ ownerUserId: ID }).success).toBe(false);
  });

  it('UploadRouteQuery: название 3–120, одна строка, обрезка', () => {
    expect(UploadRouteQuery.parse({ title: '  Круг  ' })).toEqual({ title: 'Круг' });
    expect(UploadRouteQuery.safeParse({}).success).toBe(false);
    expect(UploadRouteQuery.safeParse({ title: 'ab' }).success).toBe(false);
    expect(UploadRouteQuery.safeParse({ title: 'a'.repeat(121) }).success).toBe(false);
    expect(UploadRouteQuery.safeParse({ title: 'две\nстроки' }).success).toBe(false);
    expect(UploadRouteQuery.safeParse({ title: 'Круг', extra: '1' }).success).toBe(false);
  });
});
