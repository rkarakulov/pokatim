// Синтетика для unit-тестов движка: координаты в метрах от центра Минска (x — восток, y — север).
import type { CorridorGeometry, ParsedPoint } from '../../track.ts';

export const CENTER = { lat: 53.9006, lon: 27.559 };
export const M_LAT = 111_195;
export const M_LON = M_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
export const T0 = Date.UTC(2026, 5, 14, 6, 0, 0);

export type Xy = [number, number];

export const at = ([x, y]: Xy): [number, number] => [
  CENTER.lon + x / M_LON,
  CENTER.lat + y / M_LAT,
];

export function polylineLength(points: readonly Xy[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return total;
}

/** Позиция на ломаной на расстоянии `along` от начала (за концами — продолжение крайних отрезков). */
export function pointAt(points: readonly Xy[], along: number): Xy {
  let rest = along;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (rest <= length || i === points.length - 1) {
      const u = rest / length;
      return [ax + (bx - ax) * u, ay + (by - ay) * u];
    }
    rest -= length;
  }
  return points[0]!;
}

export function corridorOf(
  line: readonly Xy[],
  options: Partial<CorridorGeometry> = {},
): CorridorGeometry {
  return {
    line: line.map(at),
    widthM: 50,
    isLoop: false,
    distanceM: polylineLength(line),
    ...options,
  };
}

/** Проезд по ломаной с постоянной скоростью: точка раз в `intervalS` с, начиная с `startMs`. */
export function ride(
  path: readonly Xy[],
  options: { speed: number; intervalS?: number; startMs?: number; from?: number; to?: number },
): ParsedPoint[] {
  const interval = options.intervalS ?? 1;
  const startMs = options.startMs ?? T0;
  const from = options.from ?? 0;
  const to = options.to ?? polylineLength(path);
  const result: ParsedPoint[] = [];
  for (let k = 0; from + k * interval * options.speed <= to + 1e-9; k += 1) {
    const [lon, lat] = at(pointAt(path, from + k * interval * options.speed));
    result.push({ lon, lat, time: new Date(startMs + k * interval * 1000) });
  }
  return result;
}

/** Точки по списку позиций, раз в `intervalS` с. */
export function track(positions: readonly Xy[], startMs = T0, intervalS = 1): ParsedPoint[] {
  return positions.map((position, k) => {
    const [lon, lat] = at(position);
    return { lon, lat, time: new Date(startMs + k * intervalS * 1000) };
  });
}

/** Целые шаги от `from` до `to` включительно (`step` со знаком). */
export function steps(from: number, to: number, step: number): number[] {
  const result: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) result.push(v);
  return result;
}

/** mulberry32 — детерминированный псевдослучайный поток [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Проезд 1 Гц с коррелированным шумом GPS (AR(1), ρ = 0.95, стационарное σ). */
export function noisyRide(
  path: readonly Xy[],
  sigma: number,
  seed: number,
  speed = 8,
): ParsedPoint[] {
  const random = mulberry32(seed);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
  const rho = 0.95;
  const innovation = sigma * Math.sqrt(1 - rho * rho);
  let nx = gauss() * sigma;
  let ny = gauss() * sigma;
  const positions: Xy[] = [];
  const total = polylineLength(path);
  for (let k = 0; k * speed <= total; k += 1) {
    const [x, y] = pointAt(path, k * speed);
    nx = rho * nx + innovation * gauss();
    ny = rho * ny + innovation * gauss();
    positions.push([x + nx, y + ny]);
  }
  return track(positions);
}

/** Точки по позициям с явными моментами (секунды от T0). */
export function timed(positions: readonly Xy[], seconds: readonly number[]): ParsedPoint[] {
  return positions.map((position, k) => {
    const [lon, lat] = at(position);
    return { lon, lat, time: new Date(T0 + seconds[k]! * 1000) };
  });
}
