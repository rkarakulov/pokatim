/// <reference types="jest" />
import { CITY_CENTERS, type RideMapPoint } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';

import {
  POINT_PAD_DEG,
  pointsBounds,
  rideGroups,
  ridePointFeatures,
  ridePointLayers,
  RIDE_POINTS_SOURCE_ID,
} from './ride-points-style';

let seq = 0;
const point = (
  start: readonly [number, number],
  extra: Partial<RideMapPoint> = {},
): RideMapPoint => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Райд ${seq}`,
  startsAt: '2026-10-04T07:00:00Z',
  start: [start[0], start[1]],
  goingCount: 3,
  limit: null,
  full: false,
  ...extra,
});

const MINSK = [27.5615, 53.9023] as const;
const BREST = [23.7341, 52.0976] as const;

describe('точки старта на карте ленты (05c)', () => {
  it('одинаковые координаты — одна точка с числом райдов; порядок групп — по времени первой', () => {
    const a = point(MINSK);
    const b = point(BREST);
    // тот же старт популярного маршрута, разница меньше 1e-5° — та же точка
    const c = point([MINSK[0] + 0.000001, MINSK[1]]);
    const groups = rideGroups([a, b, c]);
    expect([...groups.values()].map((group) => group.map((ride) => ride.id))).toEqual([
      [a.id, c.id],
      [b.id],
    ]);

    const features = ridePointFeatures([a, b, c]);
    expect(features.features).toHaveLength(2);
    expect(features.features.map((feature) => feature.properties)).toEqual([
      { key: [...groups.keys()][0], count: 2 },
      { key: [...groups.keys()][1], count: 1 },
    ]);
    expect(features.features[1]!.geometry.coordinates).toEqual([...BREST]);
  });

  it('слои — только на ролях темы карты во всех 7 темах: круг и число у группы', () => {
    const schemes = Object.values(appThemes).flatMap((def) => [
      def.schemes.light,
      def.schemes.dark,
    ]);
    for (const theme of schemes) {
      const layers = ridePointLayers(theme);
      expect(layers.map((layer) => [layer.id, layer.type, layer.source])).toEqual([
        ['ride-points', 'circle', RIDE_POINTS_SOURCE_ID],
        ['ride-points-count', 'symbol', RIDE_POINTS_SOURCE_ID],
      ]);
      const roles = Object.values(theme.map);
      const [circle, count] = layers;
      if (circle?.type !== 'circle' || count?.type !== 'symbol') throw new Error('слои');
      expect(roles).toContain(circle.paint?.['circle-color']);
      expect(roles).toContain(circle.paint?.['circle-stroke-color']);
      expect(roles).toContain(count.paint?.['text-color']);
      expect(count.filter).toEqual(['>', ['get', 'count'], 1]);
    }
  });

  it('рамка: по точкам и позиции «Рядом»; одна точка — расширена; пусто — центр города', () => {
    const [a, b] = [point(MINSK), point(BREST)];
    expect(pointsBounds([a, b], null, CITY_CENTERS.minsk)).toEqual([
      BREST[0],
      BREST[1],
      MINSK[0],
      MINSK[1],
    ]);
    expect(pointsBounds([a], null, CITY_CENTERS.minsk)).toEqual([
      MINSK[0] - POINT_PAD_DEG,
      MINSK[1] - POINT_PAD_DEG,
      MINSK[0] + POINT_PAD_DEG,
      MINSK[1] + POINT_PAD_DEG,
    ]);
    const me = [27.4, 53.8] as const;
    expect(pointsBounds([a], me, CITY_CENTERS.minsk)).toEqual([me[0], me[1], MINSK[0], MINSK[1]]);
    const [lon, lat] = CITY_CENTERS.brest;
    expect(pointsBounds([], null, CITY_CENTERS.brest)).toEqual([
      lon - POINT_PAD_DEG,
      lat - POINT_PAD_DEG,
      lon + POINT_PAD_DEG,
      lat + POINT_PAD_DEG,
    ]);
  });
});
