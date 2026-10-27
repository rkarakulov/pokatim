/// <reference types="jest" />
import { mercatorProjector, scrubTolerance } from './scrub-line';

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

  it('scrubTolerance: 15 м в единицах вида по масштабу линии; длина 0 — 0', () => {
    // 100 px на 1000 м → 15 м = 1,5 px
    expect(
      scrubTolerance(
        [
          [0, 0],
          [100, 0],
        ],
        [0, 1000],
      ),
    ).toBeCloseTo(1.5, 9);
    expect(scrubTolerance([[0, 0]], [0])).toBe(0);
  });
});
