import { describe, expect, expectTypeOf, it } from 'vitest';

import { RACE_ROUTE_MAX_POINTS, type RaceRouteMap } from '../races/race-route.schema.ts';
import {
  CATALOG_ROUTE_LIST_MAX_LIMIT,
  CATALOG_ROUTE_PROFILE_MAX_POINTS,
  ROUTE_EXPORT_FORMATS,
  CatalogRouteCard,
  CatalogRouteCities,
  CatalogRouteDetail,
  CatalogRoutePage,
  CatalogRouteQuery,
  CatalogRouteRacesQuery,
  CatalogRouteAuthor,
  ROUTE_AUTHOR_KINDS,
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
    expect(CatalogRouteCard.parse(card)).toEqual({ ...card, author: { kind: 'team' } });
    expect(
      CatalogRouteCard.parse({ ...card, city: 'kaunas', surfaces: ['asphalt', 'cobbles'] }),
    ).toEqual({
      ...card,
      city: 'unknown',
      surfaces: ['asphalt', 'unknown'],
      author: { kind: 'team' },
    });
    expect(CatalogRouteCard.parse({ ...card, elevationGainM: null }).elevationGainM).toBeNull();
    expect(Object.keys(CatalogRouteCard.parse({ ...card, ownerUserId: ID })).sort()).toEqual(
      [...Object.keys(card), 'author'].sort(),
    );
    expect(CatalogRouteDetail.parse(card)).toEqual({
      ...card,
      author: { kind: 'team' },
      elevation: null,
      gpxAvailable: false,
      exportFormats: [],
    });
    expect(CatalogRoutePage.parse({ items: [card], nextCursor: null }).items).toHaveLength(1);
  });

  it('CatalogRouteDetail (routes-03): профиль высоты и gpxAvailable; без полей — дефолты (RC-10)', () => {
    const elevation = {
      minM: 191,
      maxM: 267,
      profile: [
        [0, 191],
        [86_012, 267],
      ],
    };
    const detail = { ...card, elevation, gpxAvailable: true };
    const team = { kind: 'team' };
    expect(CatalogRouteDetail.parse(detail)).toEqual({
      ...detail,
      author: team,
      exportFormats: [],
    });
    expect(CatalogRouteDetail.parse({ ...card, elevation: null, gpxAvailable: true })).toEqual({
      ...card,
      author: team,
      elevation: null,
      gpxAvailable: true,
      exportFormats: [],
    });
    expect(CATALOG_ROUTE_PROFILE_MAX_POINTS).toBe(300);
    const point = [0, 200];
    for (const broken of [
      { ...elevation, profile: [[0, 191]] },
      {
        ...elevation,
        profile: Array.from({ length: CATALOG_ROUTE_PROFILE_MAX_POINTS + 1 }, () => point),
      },
      {
        ...elevation,
        profile: [
          [0, 191.5],
          [10, 192],
        ],
      },
      {
        ...elevation,
        profile: [
          [-1, 191],
          [10, 192],
        ],
      },
      { ...elevation, minM: 1.5 },
    ]) {
      expect(CatalogRouteDetail.safeParse({ ...card, elevation: broken }).success).toBe(false);
    }
    expect(CatalogRouteDetail.safeParse({ ...card, gpxAvailable: 'yes' }).success).toBe(false);
  });

  it('CatalogRouteDetail.exportFormats (routes-formats): без поля — [], незнакомый формат отброшен (RC-3)', () => {
    expect(ROUTE_EXPORT_FORMATS).toEqual(['gpx', 'kml', 'tcx']);
    expect(CatalogRouteDetail.parse(card).exportFormats).toEqual([]);
    expect(
      CatalogRouteDetail.parse({ ...card, exportFormats: ['gpx', 'kml', 'tcx'] }).exportFormats,
    ).toEqual(['gpx', 'kml', 'tcx']);
    // новый формат сервера (FIT-курс) не роняет карточку этой сборки
    expect(
      CatalogRouteDetail.parse({ ...card, exportFormats: ['gpx', 'fit', 'tcx'] }).exportFormats,
    ).toEqual(['gpx', 'tcx']);
    expect(CatalogRouteDetail.safeParse({ ...card, exportFormats: 'gpx' }).success).toBe(false);
    expect(CatalogRouteDetail.safeParse({ ...card, exportFormats: [1] }).success).toBe(false);
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

describe('маршруты райдеров в каталоге (routes-06)', () => {
  it('автор: команда или райдер с именем/null; нет поля — команда (новый клиент, старый API)', () => {
    expect(ROUTE_AUTHOR_KINDS).toEqual(['team', 'rider']);
    for (const author of [
      { kind: 'team' },
      { kind: 'rider', name: null },
      { kind: 'rider', name: 'Аня' },
    ]) {
      expect(CatalogRouteCard.parse({ ...card, author }).author).toEqual(author);
      expect(CatalogRouteDetail.parse({ ...card, author }).author).toEqual(author);
    }
    expect(CatalogRouteAuthor.safeParse({ kind: 'rider' }).success).toBe(false);
    expect(CatalogRouteAuthor.parse({ kind: 'team', name: 'x' })).toEqual({ kind: 'team' });
  });

  it('CatalogRouteQuery.author: одна строка — массив, обе; неизвестное значение и > 2 — ошибка', () => {
    expect(CatalogRouteQuery.parse({ author: 'rider' })).toEqual({ limit: 20, author: ['rider'] });
    expect(CatalogRouteQuery.parse({ author: ['team', 'rider'] }).author).toEqual([
      'team',
      'rider',
    ]);
    expect(CatalogRouteQuery.safeParse({ author: 'platform' }).success).toBe(false);
    expect(CatalogRouteQuery.safeParse({ author: ['team', 'rider', 'team'] }).success).toBe(false);
  });
});
