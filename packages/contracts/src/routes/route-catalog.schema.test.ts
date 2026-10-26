import { describe, expect, expectTypeOf, it } from 'vitest';

import { RACE_ROUTE_MAX_POINTS, type RaceRouteMap } from '../races/race-route.schema.ts';
import {
  CATALOG_ROUTE_LIST_MAX_LIMIT,
  CatalogRouteCard,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  CatalogRouteQuery,
  CatalogRouteRacesQuery,
  ROUTE_DISTANCE_BUCKETS,
  RouteMapGeometry,
} from './route-catalog.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const card = {
  id: ID,
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  publishedAt: '2026-10-27T10:00:00.000Z',
};

const geometry = {
  line: [
    [27.55, 53.9],
    [27.56, 53.91],
  ],
  start: [27.55, 53.9],
  finish: [27.56, 53.91],
  bounds: [27.55, 53.9, 27.56, 53.91],
};

describe('каталог маршрутов (routes-01)', () => {
  it('корзины дистанции — в установленном порядке, лимит списка 50', () => {
    expect(ROUTE_DISTANCE_BUCKETS).toEqual(['lt50', '50to100', 'gt100']);
    expect(CATALOG_ROUTE_LIST_MAX_LIMIT).toBe(50);
  });

  it('CatalogRouteQuery: по умолчанию limit 20; одиночная строка — массив; несколько значений', () => {
    expect(CatalogRouteQuery.parse({})).toEqual({ limit: 20 });
    expect(
      CatalogRouteQuery.parse({
        city: 'minsk',
        distance: ['lt50', 'gt100'],
        surface: 'gravel',
        limit: '50',
        cursor: 'abc',
      }),
    ).toEqual({
      city: ['minsk'],
      distance: ['lt50', 'gt100'],
      surface: ['gravel'],
      limit: 50,
      cursor: 'abc',
    });
  });

  it('CatalogRouteQuery: неизвестный город, корзина, покрытие, лишний ключ, limit 51 — ошибка', () => {
    for (const broken of [
      { city: 'moscow' },
      { distance: 'lt10' },
      { surface: 'cobbles' },
      { status: 'ready' },
      { limit: '51' },
      { limit: '0' },
      { distance: ['lt50', '50to100', 'gt100', 'lt50'] },
    ]) {
      expect(CatalogRouteQuery.safeParse(broken).success, JSON.stringify(broken)).toBe(false);
    }
  });

  it('CatalogRouteCard: незнакомые город и покрытие — unknown; лишние поля отбрасываются', () => {
    expect(CatalogRouteCard.parse(card)).toEqual(card);
    expect(
      CatalogRouteCard.parse({ ...card, city: 'kaunas', surfaces: ['asphalt', 'cobbles'] }),
    ).toEqual({ ...card, city: 'unknown', surfaces: ['asphalt', 'unknown'] });
    expect(CatalogRouteCard.parse({ ...card, elevationGainM: null }).elevationGainM).toBeNull();
    expect(Object.keys(CatalogRouteCard.parse({ ...card, ownerUserId: ID })).sort()).toEqual(
      Object.keys(card).sort(),
    );
    expect(CatalogRouteDetail.parse(card)).toEqual(card);
    expect(CatalogRoutePage.parse({ items: [card], nextCursor: null }).items).toHaveLength(1);
  });

  it('CatalogRouteCities: незнакомые коды отбрасываются', () => {
    expect(CatalogRouteCities.parse({ cities: ['minsk', 'kaunas', 'brest'] })).toEqual({
      cities: ['minsk', 'brest'],
    });
  });

  it('RouteMapGeometry: валидная; 1 и 1001 точка, рамка из 3 чисел — ошибка', () => {
    expect(RouteMapGeometry.parse(geometry)).toEqual(geometry);
    const point: [number, number] = [27.5, 53.9];
    for (const broken of [
      { ...geometry, line: [point] },
      { ...geometry, line: Array.from({ length: RACE_ROUTE_MAX_POINTS + 1 }, () => point) },
      { ...geometry, bounds: [27.55, 53.9, 27.56] },
    ]) {
      expect(RouteMapGeometry.safeParse(broken).success).toBe(false);
    }
  });

  it('RaceRouteMap присваивается RouteMapGeometry (общая часть, RC-6)', () => {
    expectTypeOf<RaceRouteMap>().toExtend<RouteMapGeometry>();
  });

  it('CatalogRouteRacesQuery: limit по умолчанию 20, максимум 50; лишний ключ — ошибка', () => {
    expect(CatalogRouteRacesQuery.parse({})).toEqual({ limit: 20 });
    expect(CatalogRouteRacesQuery.parse({ limit: '10', cursor: 'x' })).toEqual({
      limit: 10,
      cursor: 'x',
    });
    expect(CatalogRouteRacesQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(CatalogRouteRacesQuery.safeParse({ scope: 'past' }).success).toBe(false);
  });
});
