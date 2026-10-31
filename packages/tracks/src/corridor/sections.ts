import { haversineMeters, localProjection } from '../geo.ts';
import { corridorGateRadiusM } from '../track.ts';

/**
 * Версия разбиения маршрута на участки и их сверки (route-rides-05) — пишется в `route_rides.sections.version`.
 * Отдельна от `CORRIDOR_ENGINE_VERSION`: участки — неизменённый движок на подлиниях. Любое изменение
 * `ROUTE_SECTION_POLICY` или `routeSections`/`sectionLine` → +1 (участки разных версий не сравниваются).
 */
export const ROUTE_SECTIONS_VERSION = 1;

/** Пороги разбиения (часть версии 1). Расстояния — м по chainage линии сверки. */
export const ROUTE_SECTION_POLICY = {
  /** границы участков — через каждые `stepM` от старта */
  stepM: 10_000,
  /** хвост короче — сливается с последним участком */
  minTailM: 5_000,
  /** маршрут короче — участков нет */
  minRouteM: 15_000,
  /** участков больше — участков нет (= `ROUTE_RIDE_SECTIONS_MAX` контрактов) */
  maxSections: 30,
  /** запас к `2 · радиус ворот`: концы участка ближе — участок сливается с соседним (ворота линейного коридора) */
  gateMarginM: 50,
} as const;

/** Участок маршрута: метры по линии сверки от старта (целые), `toM` последнего = длина линии. */
export interface RouteSection {
  fromM: number;
  toM: number;
}

type LonLat = readonly [number, number];

/** Chainage вершин линии, м: сумма `haversineMeters` (не уплотнённая линия движка). */
function chainageOf(line: readonly LonLat[]): Float64Array {
  const chainage = new Float64Array(line.length);
  for (let i = 1; i < line.length; i += 1) {
    const [aLon, aLat] = line[i - 1]!;
    const [bLon, bLat] = line[i]!;
    chainage[i] =
      chainage[i - 1]! + haversineMeters({ lon: aLon, lat: aLat }, { lon: bLon, lat: bLat });
  }
  return chainage;
}

/** Последняя вершина с chainage ≤ `m` (двоичный поиск); у последней вершины — предпоследний отрезок. */
function segmentAt(chainage: Float64Array, m: number): number {
  let lo = 0;
  let hi = chainage.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (chainage[mid]! <= m) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Точка линии на chainage `m` (концы — зажаты): линейная интерполяция на отрезке. */
function pointAtChainage(
  line: readonly LonLat[],
  chainage: Float64Array,
  m: number,
): [number, number] {
  const total = chainage[chainage.length - 1]!;
  const along = Math.min(Math.max(m, 0), total);
  const i = segmentAt(chainage, along);
  const length = chainage[i + 1]! - chainage[i]!;
  const u = length > 0 ? (along - chainage[i]!) / length : 0;
  const [aLon, aLat] = line[i]!;
  const [bLon, bLat] = line[i + 1]!;
  return [aLon + (bLon - aLon) * u, aLat + (bLat - aLat) * u];
}

/**
 * Линия, пройденная от `points[0]`, после выхода из радиуса `radiusM` вокруг него снова подходит к нему ближе
 * `radiusM` (расстояние до отрезков, локальная проекция вокруг точки). Ворота линейного коридора: движок завершает
 * попытку на повторном входе в ворота старта — такой участок не засчитывается честным проездом.
 */
function returnsTo(points: readonly LonLat[], radiusM: number): boolean {
  const [lon0, lat0] = points[0]!;
  const { kx, ky } = localProjection(lat0);
  const x = (i: number) => (points[i]![0] - lon0) * kx;
  const y = (i: number) => (points[i]![1] - lat0) * ky;
  let left = -1;
  for (let i = 1; i < points.length; i += 1) {
    if (left < 0) {
      if (Math.hypot(x(i), y(i)) > radiusM) left = i;
      continue;
    }
    // расстояние от центра ворот до отрезка (i − 1, i)
    const ax = x(i - 1);
    const ay = y(i - 1);
    const dx = x(i) - ax;
    const dy = y(i) - ay;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2)) : 0;
    if (Math.hypot(ax + dx * t, ay + dy * t) <= radiusM) return true;
  }
  return false;
}

/**
 * Участки маршрута (route-rides-05, U1): границы через каждые `stepM` по chainage линии сверки, хвост < `minTailM`
 * — к последнему участку; маршрут < `minRouteM` — `[]`. Участок, концы которого ближе `2 · corridorGateRadiusM(widthM)
 * + gateMarginM` (разворот «туда-обратно»: ворота линейного коридора перекрылись бы) или линия которого после выхода
 * из этого радиуса снова подходит к своему началу или концу (§8.2 Q1: движок не засчитывает повторный вход в ворота;
 * у «туда-обратно» по одной дороге участков нет), сливается со следующим (последний — с предыдущим) до устойчивости. Итог < 2 или > `maxSections` — `[]`. Чистая и детерминированная:
 * считает на неокруглённом chainage, округляет только выход (`toM` последнего = `round(L)`, без зазоров).
 */
export function routeSections(line: readonly LonLat[], widthM: number): RouteSection[] {
  if (line.length < 2) return [];
  const chainage = chainageOf(line);
  const total = chainage[chainage.length - 1]!;
  const { stepM, minTailM, minRouteM, maxSections, gateMarginM } = ROUTE_SECTION_POLICY;
  if (total < minRouteM) return [];

  const bounds = [0];
  for (let k = 1; total - k * stepM >= minTailM; k += 1) bounds.push(k * stepM);
  bounds.push(total);

  const minEndsM = 2 * corridorGateRadiusM(widthM) + gateMarginM;
  const ungated = (fromM: number, toM: number) => {
    const sub = sectionLine(line, fromM, toM);
    const [aLon, aLat] = sub[0]!;
    const [bLon, bLat] = sub[sub.length - 1]!;
    return (
      haversineMeters({ lon: aLon, lat: aLat }, { lon: bLon, lat: bLat }) <= minEndsM ||
      returnsTo(sub, minEndsM) ||
      returnsTo([...sub].reverse(), minEndsM)
    );
  };
  let merged = true;
  while (merged && bounds.length > 2) {
    merged = false;
    for (let i = 0; i + 1 < bounds.length; i += 1) {
      if (!ungated(bounds[i]!, bounds[i + 1]!)) continue;
      // слияние со следующим участком — убрать его левую границу; последний — с предыдущим
      bounds.splice(i + 2 < bounds.length ? i + 1 : i, 1);
      merged = true;
      break;
    }
  }

  const sections = bounds.length - 1;
  if (sections < 2 || sections > maxSections) return [];
  return Array.from({ length: sections }, (_, i) => ({
    fromM: Math.round(bounds[i]!),
    toM: Math.round(bounds[i + 1]!),
  }));
}

/**
 * Подлиния участка `[fromM, toM]` (м по chainage линии): интерполированные концы + вершины строго между ними
 * (≥ 2 точки). Соседние подлинии стыкуются в общей точке границы.
 */
export function sectionLine(
  line: readonly LonLat[],
  fromM: number,
  toM: number,
): [number, number][] {
  const chainage = chainageOf(line);
  const result: [number, number][] = [pointAtChainage(line, chainage, fromM)];
  for (let i = segmentAt(chainage, fromM) + 1; i < line.length && chainage[i]! < toM; i += 1) {
    if (chainage[i]! > fromM) result.push([line[i]![0], line[i]![1]]);
  }
  result.push(pointAtChainage(line, chainage, toM));
  return result;
}
