import { describe, expect, it } from 'vitest';

import { ROUTE_PACE_KMH, routeDurationMin, routePaceKmh } from './pace.ts';

describe('время в пути (routes-03, P3; routes-05, RC-11)', () => {
  it('скорость по покрытию: асфальт 27, гравий 20, оба 24, пусто/unknown — 27', () => {
    expect(ROUTE_PACE_KMH).toEqual({ asphalt: 27, gravel: 20, mixed: 24 });
    expect(routePaceKmh(['asphalt'])).toBe(27);
    expect(routePaceKmh(['gravel'])).toBe(20);
    expect(routePaceKmh(['gravel', 'asphalt'])).toBe(24);
    expect(routePaceKmh([])).toBe(27);
    expect(routePaceKmh(['unknown'])).toBe(27);
    expect(routePaceKmh(['unknown', 'gravel'])).toBe(20);
  });

  it('68 км при 27 км/ч — 150 мин; шаг 5 мин; минимум 5 мин', () => {
    expect(routeDurationMin(68_000, 27)).toBe(150);
    expect(routeDurationMin(1_000, 27)).toBe(5);
    expect(routeDurationMin(20_000, 27)).toBe(45);
  });
});
