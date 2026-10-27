import { describe, expect, it } from 'vitest';

import {
  MY_ROUTE_LIST_MAX_LIMIT,
  MY_ROUTE_MAX_COUNT,
  MyRoute,
  MyRoutePage,
  MyRouteQuery,
  RenameRouteInput,
} from './my-route.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const route = {
  id: ID,
  title: 'Кольцо',
  status: 'ready',
  failure: null,
  distanceM: 42_000,
  elevationGainM: null,
  isLoop: true,
  createdAt: '2026-10-27T10:00:00.000Z',
};

describe('мои маршруты', () => {
  it('MyRoute: готовый и в обработке', () => {
    expect(MyRoute.parse(route)).toEqual(route);
    expect(
      MyRoute.parse({
        ...route,
        status: 'processing',
        distanceM: null,
        isLoop: null,
      }).status,
    ).toBe('processing');
  });

  it('MyRoute: новый статус и новый код отказа — unknown (R6)', () => {
    const parsed = MyRoute.parse({ ...route, status: 'archived', failure: 'virus' });
    expect(parsed.status).toBe('unknown');
    expect(parsed.failure).toBe('unknown');
  });

  it('MyRoutePage', () => {
    expect(MyRoutePage.parse({ items: [route], nextCursor: null }).items).toHaveLength(1);
  });

  it('MyRouteQuery: умолчание 20, предел 50, лишний ключ — ошибка', () => {
    expect(MyRouteQuery.parse({})).toEqual({ limit: 20 });
    expect(MyRouteQuery.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    expect(MY_ROUTE_LIST_MAX_LIMIT).toBe(50);
    expect(MyRouteQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(MyRouteQuery.safeParse({ status: 'ready' }).success).toBe(false);
  });

  it('RenameRouteInput: 3–120, одна строка, trim, без лишних ключей', () => {
    expect(RenameRouteInput.parse({ title: '  Кольцо  ' })).toEqual({ title: 'Кольцо' });
    expect(RenameRouteInput.safeParse({ title: 'ab' }).success).toBe(false);
    expect(RenameRouteInput.safeParse({ title: 'a'.repeat(121) }).success).toBe(false);
    expect(RenameRouteInput.safeParse({ title: 'a'.repeat(120) }).success).toBe(true);
    expect(RenameRouteInput.safeParse({ title: 'Коль\nцо' }).success).toBe(false);
    expect(RenameRouteInput.safeParse({ title: 'Кольцо', city: 'minsk' }).success).toBe(false);
  });

  it('квота своих маршрутов — 100', () => {
    expect(MY_ROUTE_MAX_COUNT).toBe(100);
  });
});
