import type { CatalogRouteElevation } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import {
  fractionAt,
  PROFILE_VIEW_HEIGHT,
  PROFILE_VIEW_WIDTH,
  profilePaths,
  profileTickValues,
  scrubKeyTarget,
  scrubStep,
  scrubValues,
} from './profile.ts';

// 0 → 1 км подъём 5 %, 1 → 2 км спуск 3 %
const elevation: CatalogRouteElevation = {
  minM: 200,
  maxM: 250,
  profile: Array.from({ length: 9 }, (_, i) => {
    const d = i * 250;
    return [d, d <= 1000 ? 200 + d * 0.05 : 250 - (d - 1000) * 0.03];
  }),
};

describe('профиль высоты (routes-05: общий для приложения и панели)', () => {
  it('profilePaths: линия от левого до правого края, площадь замкнута по низу; < 2 точек — null', () => {
    const paths = profilePaths(elevation)!;
    expect(paths.line.startsWith('M0,')).toBe(true);
    expect(paths.line).toContain(`${PROFILE_VIEW_WIDTH},`);
    expect(
      paths.area.endsWith(
        `L${PROFILE_VIEW_WIDTH},${PROFILE_VIEW_HEIGHT}L0,${PROFILE_VIEW_HEIGHT}Z`,
      ),
    ).toBe(true);
    expect(profilePaths({ minM: 1, maxM: 1, profile: [[0, 1]] })).toBeNull();
  });

  it('profileTickValues: шаг 1/2/5 × 10ⁿ, ≤ 5 тиков, доля оси; длина 0 — пусто', () => {
    expect(profileTickValues(68_000).map((tick) => tick.km)).toEqual([0, 20, 40, 60]);
    expect(profileTickValues(1_200).map((tick) => tick.km)).toEqual([0, 0.5, 1]);
    expect(profileTickValues(68_000).at(-1)!.position).toBeCloseTo(60 / 68, 6);
    expect(profileTickValues(0)).toEqual([]);
  });

  it('scrubValues: км (десятые) маршрута, высота и уклон по доле профиля, набор масштабирован', () => {
    expect(scrubValues(elevation, 2000, null, 0.25)).toEqual({
      km: 0.5,
      elevationM: 225,
      grade: 5,
      gainM: 25,
    });
    expect(scrubValues(elevation, 2000, 60, 0.75)).toEqual({
      km: 1.5,
      elevationM: 235,
      grade: -3,
      gainM: 60,
    });
    // маршрут объявлен 4 км, профиль 2 км: та же доля — «2 км» и вершина подъёма
    expect(scrubValues(elevation, 4000, null, 0.5)).toMatchObject({ km: 2, elevationM: 250 });
  });

  it('scrubStep: доля → следующий/предыдущий целый км → доля; границы 0 и 1', () => {
    expect(scrubStep(0, 3500, 1)).toBeCloseTo(1000 / 3500, 9);
    expect(scrubStep(3000 / 3500, 3500, 1)).toBe(1);
    expect(scrubStep(1, 3500, -1)).toBeCloseTo(3000 / 3500, 9);
    expect(scrubStep(0, 3500, -1)).toBe(0);
    expect(scrubStep(0.5, 0, 1)).toBe(0);
  });

  it('scrubKeyTarget: →/↑ и ←/↓ — ±1 км, Home/End — 0 и 1, прочее — null', () => {
    expect(scrubKeyTarget('ArrowRight', 0, 3500)).toBeCloseTo(1000 / 3500, 9);
    expect(scrubKeyTarget('ArrowUp', 0, 3500)).toBeCloseTo(1000 / 3500, 9);
    expect(scrubKeyTarget('ArrowLeft', 1, 3500)).toBeCloseTo(3000 / 3500, 9);
    expect(scrubKeyTarget('ArrowDown', 1, 3500)).toBeCloseTo(3000 / 3500, 9);
    expect(scrubKeyTarget('Home', 0.5, 3500)).toBe(0);
    expect(scrubKeyTarget('End', 0.5, 3500)).toBe(1);
    expect(scrubKeyTarget('Enter', 0.5, 3500)).toBeNull();
  });

  it('fractionAt: доля по горизонтали с ограничением 0…1; ширина 0 — 0', () => {
    expect(fractionAt(150, 100, 200)).toBe(0.25);
    expect(fractionAt(50, 100, 200)).toBe(0);
    expect(fractionAt(400, 100, 200)).toBe(1);
    expect(fractionAt(150, 100, 0)).toBe(0);
  });
});
