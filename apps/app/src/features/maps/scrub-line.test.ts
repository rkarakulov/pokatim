/// <reference types="jest" />
import { nearestFraction, type Planar } from '@pokatim/tracks';

import { mercatorProjector, SCRUB_TOLERANCE_MIN_PX, scrubTolerance } from './scrub-line';

describe('scrub-line (routes-04, RC-2)', () => {
  it('mercatorProjector: углы рамки → углы вида; по широте — не линейно (Web Mercator)', () => {
    const project = mercatorProjector([27, 53, 28, 54], 300, 200);
    const [x0, y0] = project([27, 54]);
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(0, 9);
    const [x1, y1] = project([28, 53]);
    expect(x1).toBeCloseTo(300, 9);
    expect(y1).toBeCloseTo(200, 9);
    const [xm, ym] = project([27.5, 53.5]);
    expect(xm).toBeCloseTo(150, 9);
    // середина по широте на Mercator — ниже середины вида (север растянут)
    expect(ym).toBeGreaterThan(100);
    expect(ym).toBeLessThan(101);
  });

  it('mercatorProjector: вырожденная рамка — без NaN', () => {
    const [x, y] = mercatorProjector([27, 53, 27, 53], 300, 200)([27, 53]);
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  it('scrubTolerance: 15 м в единицах вида по масштабу линии, не меньше SCRUB_TOLERANCE_MIN_PX', () => {
    // крупный масштаб: 1000 px на 100 м → 15 м = 150 px
    expect(
      scrubTolerance(
        [
          [0, 0],
          [1000, 0],
        ],
        [0, 100],
      ),
    ).toBeCloseTo(150, 9);
    // обзорный: 100 px на 1000 м → 1,5 px → нижняя граница
    expect(
      scrubTolerance(
        [
          [0, 0],
          [100, 0],
        ],
        [0, 1000],
      ),
    ).toBe(SCRUB_TOLERANCE_MIN_PX);
    expect(scrubTolerance([[0, 0]], [0])).toBe(SCRUB_TOLERANCE_MIN_PX);
  });

  it('обзорный масштаб: «туда-обратно» с проходами в 30 м (≈ 0,33 px) — палец ведёт без прыжка на другой проход (M3)', () => {
    // 30 км туда и обратно в 335 px: 30 м между проходами ≈ 0,33 px, 15 м ≈ 0,17 px
    const gap = (30 * 335) / 30_000;
    const points: Planar[] = [
      [0, 0],
      [335, 0],
      [335, gap],
      [0, gap],
    ];
    const cumulative = [0, 30_000, 30_030, 60_030];
    const tolerance = scrubTolerance(points, cumulative);
    // ведём по прямому проходу (доля ≈ 0,15), палец чуть ближе к обратному (0,03 px против 0,30 px)
    let hint = (100 / 335) * (30_000 / 60_030) - 0.001;
    for (const x of [100, 120, 140, 160]) {
      hint = nearestFraction(points, cumulative, [x, gap - 0.03], hint, tolerance);
      expect(hint).toBeCloseTo((x / 335) * (30_000 / 60_030), 6);
    }
    // без нижней границы допуска (15 м в px) — прыжок на обратный проход
    const metersOnly = (15 * (335 * 2 + gap)) / 60_030;
    expect(
      nearestFraction(points, cumulative, [100, gap - 0.03], 0.15, metersOnly),
    ).toBeGreaterThan(0.5);
  });
});
