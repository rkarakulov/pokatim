export interface TrackPoint {
  lat: number;
  lon: number;
  /** высота, м */
  ele?: number;
  time?: Date;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Расстояние по большому кругу, м. Для клиентского pre-check; авторитетный расчёт — тот же код в worker (ADR-0007). */
export function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Метров в градусе дуги большого круга (та же сфера, что у `haversineMeters`). */
const METERS_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

/** Локальная равнопромежуточная проекция вокруг широты `lat0`: метров в градусе долготы (`kx`) и широты (`ky`). */
export function localProjection(lat0: number): { kx: number; ky: number } {
  return { kx: METERS_PER_DEGREE * Math.cos(toRad(lat0)), ky: METERS_PER_DEGREE };
}

/** Рамка [minLon, minLat, maxLon, maxLat], градусы (антимеридиан не поддерживается — Беларусь). */
export type Bounds = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Рамка точек [lon, lat]; пустой вход — `null`. */
export function boundsOf(coords: readonly (readonly [number, number])[]): Bounds | null {
  if (coords.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Рамки ближе `marginM` метров по каждой оси (пересекаются после расширения на `marginM`). Метров в градусе
 * долготы — на широте, самой далёкой от экватора: запас не меньше заявленного.
 */
export function boundsNear(a: Bounds, b: Bounds, marginM: number): boolean {
  const farLat = Math.max(Math.abs(a[1]), Math.abs(a[3]), Math.abs(b[1]), Math.abs(b[3]));
  const dLat = marginM / METERS_PER_DEGREE;
  const dLon = marginM / localProjection(Math.min(farLat, 89.9)).kx;
  return a[0] - dLon <= b[2] && b[0] <= a[2] + dLon && a[1] - dLat <= b[3] && b[1] <= a[3] + dLat;
}

export function trackLengthMeters(points: readonly TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}
