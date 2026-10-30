import { gunzipSync } from 'node:zlib';

import { routeGpx, routeKml, routeTcx } from '@pokatim/tracks/parse';
import { describe, expect, it } from 'vitest';

import { exportFilesOf } from './route-derived';

/** Синтетика на `count` точек: извилистая линия с высотами (координаты и высоты не повторяются). */
function synthetic(count: number) {
  const points = Array.from({ length: count }, (_, i) => ({
    lat: 53.9 + i * 0.00009 + Math.sin(i / 37) * 0.0004,
    lon: 27.55 + i * 0.00007 + Math.cos(i / 23) * 0.0003,
    ele: 200 + Math.round(Math.sin(i / 91) * 400) / 10,
  }));
  return { gpx: routeGpx(points), kml: routeKml(points), tcx: routeTcx(points) };
}

const FORMATS = ['gpx', 'kml', 'tcx'] as const;

describe('exportFilesOf (route-exports-gzip)', () => {
  it('gzip каждого файла: gunzipSync = исходный XML', async () => {
    const derived = synthetic(50);
    const files = await exportFilesOf(derived);
    for (const format of FORMATS) {
      expect(gunzipSync(files[format]).toString('utf8')).toBe(derived[format]);
    }
  });

  it('детерминирован: два вызова — одинаковые байты', async () => {
    const derived = synthetic(200);
    const [first, second] = await Promise.all([exportFilesOf(derived), exportFilesOf(derived)]);
    for (const format of FORMATS) {
      expect(Buffer.from(first[format]).equals(Buffer.from(second[format]))).toBe(true);
    }
  });

  // KML — только числа координат: ×3 — предел энтропии цифр; цель задачи — документ целиком (8.2 D1)
  it('20 000 точек: GPX и TCX ≤ исходного / 4, KML ≤ / 2,5, документ целиком ≤ / 8', async () => {
    const derived = synthetic(20_000);
    const files = await exportFilesOf(derived);
    const plain = (format: (typeof FORMATS)[number]) => Buffer.byteLength(derived[format], 'utf8');
    expect(files.gpx.byteLength).toBeLessThanOrEqual(plain('gpx') / 4);
    expect(files.tcx.byteLength).toBeLessThanOrEqual(plain('tcx') / 4);
    expect(files.kml.byteLength).toBeLessThanOrEqual(plain('kml') / 2.5);
    const stored = FORMATS.reduce((sum, format) => sum + files[format].byteLength, 0);
    const original = FORMATS.reduce((sum, format) => sum + plain(format), 0);
    expect(stored).toBeLessThanOrEqual(original / 8);
  });
});
