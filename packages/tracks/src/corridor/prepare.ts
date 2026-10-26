import { haversineMeters, localProjection } from '../geo.ts';
import type { CorridorGeometry } from '../track.ts';
import { CORRIDOR_POLICY } from './policy.ts';
import type { PreparedCorridor, SegmentGrid } from './types.ts';

const MAX_LINE_POINTS = 20_000;
const MIN_WIDTH_M = 20;
const MAX_WIDTH_M = 200;

/**
 * Подготовка коридора: проверка инвариантов (нарушение — ошибка программиста, не отказ попытки), прореживание
 * почти прямых участков (допуск 2 м, без разворотов), уплотнение до отрезков ≤ 25 м, chainage вершин, сеточный
 * индекс отрезков (не больше 64 в ячейке — время привязки ограничено), ворота, число ячеек покрытия 250 м.
 * Метрика коридора — длина уплотнённой линии; `distanceM` маршрута только переносится в диагностику.
 * Ворота старта — вокруг первой вершины, финиша — вокруг последней (`isLoop` — только развёртка `s` по кругам).
 */
export function prepareCorridor(geometry: CorridorGeometry): PreparedCorridor {
  const { line, widthM, isLoop, distanceM } = geometry;
  assert(
    Number.isFinite(widthM) && widthM >= MIN_WIDTH_M && widthM <= MAX_WIDTH_M,
    'widthM out of range',
  );
  assert(line.length >= 2 && line.length <= MAX_LINE_POINTS, 'line size out of range');
  for (const [lon, lat] of line) {
    assert(
      Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90,
      'line coordinate out of range',
    );
  }

  const { lon, lat, chainage } = densify(thin(line));
  assert(lon.length >= 2, 'line needs at least 2 distinct points');
  const lengthM = chainage[chainage.length - 1]!;
  const gateRadiusM = CORRIDOR_POLICY.gateRadius(widthM);
  const last = lon.length - 1;
  const ends = haversineMeters(
    { lon: lon[0]!, lat: lat[0]! },
    { lon: lon[last]!, lat: lat[last]! },
  );
  // линейный маршрут: финиш строго после старта — круги ворот не пересекаются
  assert(isLoop || ends > 2 * gateRadiusM, 'gates overlap on a linear route');

  const { ky } = localProjection(0);
  const segments = lon.length - 1;
  const segKx = new Float64Array(segments);
  for (let j = 0; j < segments; j += 1) {
    segKx[j] = localProjection((lat[j]! + lat[j + 1]!) / 2).kx;
  }
  const startGate = [lon[0]!, lat[0]!] as const;

  return {
    widthM,
    isLoop,
    lon,
    lat,
    chainage,
    lengthM,
    declaredDistanceM: distanceM,
    segKx,
    ky,
    grid: buildGrid(lon, lat, ky),
    gateRadiusM,
    startGate,
    finishGate: [lon[last]!, lat[last]!] as const,
    coverageCells: Math.max(1, Math.ceil(lengthM / CORRIDOR_POLICY.coverageCellM)),
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`corridor: ${message}`);
}

/**
 * Прореживание: вершины между якорем и концом отрезка ≤ `densifyStepM` выбрасываются, если все лежат в пределах
 * `lineToleranceM` от отрезка и проецируются на него по ходу (разворот и «туда-обратно» не схлопываются). Частые
 * вершины линии (запись GPS, планировщики) иначе множат отрезки в ячейке сетки и время привязки.
 */
function thin(line: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const tolerance = CORRIDOR_POLICY.lineToleranceM;
  const maxLength = CORRIDOR_POLICY.densifyStepM;
  const kept: (readonly [number, number])[] = [line[0]!];
  let anchor = 0;
  while (anchor < line.length - 1) {
    const [aLon, aLat] = line[anchor]!;
    const { kx, ky } = localProjection(aLat);
    const x = (i: number) => (line[i]![0] - aLon) * kx;
    const y = (i: number) => (line[i]![1] - aLat) * ky;
    let end = anchor + 1;
    for (let b = anchor + 2; b < line.length; b += 1) {
      const bx = x(b);
      const by = y(b);
      const length2 = bx * bx + by * by;
      if (length2 === 0 || length2 > maxLength * maxLength) break;
      let fits = true;
      for (let i = anchor + 1; i < b && fits; i += 1) {
        const t = (x(i) * bx + y(i) * by) / length2;
        const off = Math.abs(x(i) * by - y(i) * bx) / Math.sqrt(length2);
        fits = t >= 0 && t <= 1 && off <= tolerance;
      }
      if (!fits) break;
      end = b;
    }
    kept.push(line[end]!);
    anchor = end;
  }
  return kept;
}

function densify(line: readonly (readonly [number, number])[]): {
  lon: Float64Array;
  lat: Float64Array;
  chainage: Float64Array;
} {
  const lons: number[] = [line[0]![0]];
  const lats: number[] = [line[0]![1]];
  const chain: number[] = [0];
  for (let i = 1; i < line.length; i += 1) {
    const [aLon, aLat] = [lons[lons.length - 1]!, lats[lats.length - 1]!];
    const [bLon, bLat] = line[i]!;
    if (aLon === bLon && aLat === bLat) continue;
    const lengthM = haversineMeters({ lon: aLon, lat: aLat }, { lon: bLon, lat: bLat });
    const parts = Math.max(1, Math.ceil(lengthM / CORRIDOR_POLICY.densifyStepM));
    let prevLon = aLon;
    let prevLat = aLat;
    for (let k = 1; k <= parts; k += 1) {
      const nextLon = k === parts ? bLon : aLon + ((bLon - aLon) * k) / parts;
      const nextLat = k === parts ? bLat : aLat + ((bLat - aLat) * k) / parts;
      const step = haversineMeters({ lon: prevLon, lat: prevLat }, { lon: nextLon, lat: nextLat });
      lons.push(nextLon);
      lats.push(nextLat);
      chain.push(chain[chain.length - 1]! + step);
      prevLon = nextLon;
      prevLat = nextLat;
    }
  }
  return {
    lon: Float64Array.from(lons),
    lat: Float64Array.from(lats),
    chainage: Float64Array.from(chain),
  };
}

/**
 * Сетка 200 м (в градусах по широте центра bbox): отрезок попадает во все ячейки своего bbox. Пары «ячейка,
 * отрезок» кодируются числом `key * segments + segment` и сортируются — CSR без объектов на отрезок.
 */
function buildGrid(lon: Float64Array, lat: Float64Array, ky: number): SegmentGrid {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < lon.length; i += 1) {
    minLon = Math.min(minLon, lon[i]!);
    maxLon = Math.max(maxLon, lon[i]!);
    minLat = Math.min(minLat, lat[i]!);
    maxLat = Math.max(maxLat, lat[i]!);
  }
  const cellLat = CORRIDOR_POLICY.gridCellM / ky;
  const cellLon = CORRIDOR_POLICY.gridCellM / localProjection((minLat + maxLat) / 2).kx;
  const columns = Math.floor((maxLon - minLon) / cellLon) + 1;
  const rows = Math.floor((maxLat - minLat) / cellLat) + 1;
  const segments = lon.length - 1;
  assert(columns * rows * segments < Number.MAX_SAFE_INTEGER, 'line too large for grid');

  const column = (value: number) => Math.min(columns - 1, Math.floor((value - minLon) / cellLon));
  const row = (value: number) => Math.min(rows - 1, Math.floor((value - minLat) / cellLat));
  const pairs: number[] = [];
  for (let j = 0; j < segments; j += 1) {
    const c0 = column(Math.min(lon[j]!, lon[j + 1]!));
    const c1 = column(Math.max(lon[j]!, lon[j + 1]!));
    const r0 = row(Math.min(lat[j]!, lat[j + 1]!));
    const r1 = row(Math.max(lat[j]!, lat[j + 1]!));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) pairs.push((r * columns + c) * segments + j);
    }
  }
  const sorted = Float64Array.from(pairs).sort();
  const keys: number[] = [];
  const offsets: number[] = [];
  const segmentIds = new Int32Array(sorted.length);
  for (let i = 0; i < sorted.length; i += 1) {
    const key = Math.floor(sorted[i]! / segments);
    segmentIds[i] = sorted[i]! - key * segments;
    if (keys.length === 0 || keys[keys.length - 1] !== key) {
      keys.push(key);
      offsets.push(i);
    }
  }
  offsets.push(sorted.length);
  for (let k = 0; k + 1 < offsets.length; k += 1) {
    assert(
      offsets[k + 1]! - offsets[k]! <= CORRIDOR_POLICY.maxSegmentsPerCell,
      'line too dense (segments per grid cell)',
    );
  }
  return {
    minLon,
    minLat,
    cellLon,
    cellLat,
    columns,
    rows,
    keys: Float64Array.from(keys),
    offsets: Int32Array.from(offsets),
    segments: segmentIds,
  };
}

/**
 * Отрезки, чьи ячейки пересекают квадрат радиуса `radiusM` вокруг точки, — в `out` (без повторов, по возрастанию
 * ключа ячейки, затем номера отрезка). `stamp`/`mark` — отметка «уже добавлен» без аллокаций. Возвращает число.
 */
export function gridCandidates(
  corridor: PreparedCorridor,
  pointLon: number,
  pointLat: number,
  radiusM: number,
  out: Int32Array,
  stamp: Int32Array,
  mark: number,
): number {
  const grid = corridor.grid;
  const rLat = radiusM / corridor.ky;
  const farLat = Math.min(89.9, Math.max(Math.abs(pointLat - rLat), Math.abs(pointLat + rLat)));
  // без объекта на запрос: kx = ky · cos(широты) (как `localProjection`)
  const rLon = radiusM / (corridor.ky * Math.cos((farLat * Math.PI) / 180));
  const c0 = Math.max(0, Math.floor((pointLon - rLon - grid.minLon) / grid.cellLon));
  const c1 = Math.min(grid.columns - 1, Math.floor((pointLon + rLon - grid.minLon) / grid.cellLon));
  const r0 = Math.max(0, Math.floor((pointLat - rLat - grid.minLat) / grid.cellLat));
  const r1 = Math.min(grid.rows - 1, Math.floor((pointLat + rLat - grid.minLat) / grid.cellLat));
  let count = 0;
  for (let r = r0; r <= r1; r += 1) {
    const from = r * grid.columns + c0;
    const to = r * grid.columns + c1;
    for (let k = lowerBound(grid.keys, from); k < grid.keys.length && grid.keys[k]! <= to; k += 1) {
      for (let i = grid.offsets[k]!; i < grid.offsets[k + 1]!; i += 1) {
        const segment = grid.segments[i]!;
        if (stamp[segment] === mark) continue;
        stamp[segment] = mark;
        out[count] = segment;
        count += 1;
      }
    }
  }
  return count;
}

function lowerBound(values: Float64Array, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
