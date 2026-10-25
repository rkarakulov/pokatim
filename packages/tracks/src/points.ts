import type { ParsedPoint } from './track.ts';

/**
 * Очистка точек: отбрасываются невалидные координаты (не число, вне диапазона, ровно (0,0) — «нет фикса»)
 * и точки со временем раньше последней принятой (порядок файла не меняется, сортировки нет). Точка без
 * времени сохраняется — она участвует в дистанции и линии, но не во времени.
 */
export function sanitizePoints(points: readonly ParsedPoint[]): ParsedPoint[] {
  const result: ParsedPoint[] = [];
  let lastTime = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!isValidCoordinate(point.lat, point.lon)) continue;
    if (point.time !== undefined) {
      const time = point.time.getTime();
      if (Number.isNaN(time) || time < lastTime) continue;
      lastTime = time;
    }
    result.push(point);
  }
  return result;
}

function isValidCoordinate(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return !(lat === 0 && lon === 0);
}
