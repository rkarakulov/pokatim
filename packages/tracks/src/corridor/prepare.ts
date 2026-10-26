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
 * индекс отрезков (не больше 32 в ячейке ≈ три прохода — время привязки ограничено), ворота, число ячеек покрытия 250 м.
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
  const segDx = new Float64Array(segments);
  const segDy = new Float64Array(segments);
  const segLength2 = new Float64Array(segments);
  for (let j = 0; j < segments; j += 1) {
    segKx[j] = localProjection((lat[j]! + lat[j + 1]!) / 2).kx;
    segDx[j] = (lon[j + 1]! - lon[j]!) * segKx[j]!;
    segDy[j] = (lat[j + 1]! - lat[j]!) * ky;
    segLength2[j] = segDx[j]! ** 2 + segDy[j]! ** 2;
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
    segDx,
    segDy,
    segLength2,
    ky,
    grid: buildGrid(lon, lat, ky),
    gateRadiusM,
    startGate,
    finishGate: [lon[last]!, lat[last]!] as const,
    coverageCells: Math.max(1, Math.ceil(lengthM / CORRIDOR_POLICY.coverageCellM)),
  };
}

/**
 * Нарушение инварианта коридора: линия или допуск негодны для движка (ошибка входа, не отказ попытки). Поток разбора
 * отличает её от ошибки файла (`corridor_invalid`).
 */
export class CorridorError extends Error {
  constructor(message: string) {
    super(`corridor: ${message}`);
    this.name = 'CorridorError';
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CorridorError(message);
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

/** Расстояние от точки до отрезка маршрута j, м (локальная проекция отрезка). */
export function segmentDistance(
  corridor: PreparedCorridor,
  j: number,
  lon: number,
  lat: number,
): number {
  const px = (lon - corridor.lon[j]!) * corridor.segKx[j]!;
  const py = (lat - corridor.lat[j]!) * corridor.ky;
  const dx = corridor.segDx[j]!;
  const dy = corridor.segDy[j]!;
  const raw = (px * dx + py * dy) / corridor.segLength2[j]!;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return Math.hypot(px - t * dx, py - t * dy);
}

/** Метки посещения отрезков для запросов сетки: поколение растёт, на пределе Int32 метки очищаются. */
export interface VisitMarks {
  readonly marks: Int32Array;
  current: number;
}

export function visitMarks(segments: number): VisitMarks {
  return { marks: new Int32Array(segments), current: 0 };
}

/** Новое поколение меток; на пределе Int32 — очистка (иначе сравнение с сохранённой меткой ломается). */
export function nextVisit(visits: VisitMarks): number {
  if (visits.current >= 0x7fffffff) {
    visits.marks.fill(0);
    visits.current = 0;
  }
  visits.current += 1;
  return visits.current;
}

/**
 * Длина части отрезка a → b вне коридора, м — точно. Отрезок делится на куски ≤ `max(widthM, 25 м)`; кусок, у
 * которого расстояние от середины до маршрута + половина длины ≤ `widthM`, целиком внутри (без расчёта). Остальные —
 * пересечение с буферами («капсулами» радиуса `widthM`) отрезков маршрута рядом: интервалы по доле куска, длина
 * объединения — проходом по отсортированным началам и концам. Локальная проекция вокруг `a` (отрезок ≤ 1 км).
 */
export function chordOutsideM(
  corridor: PreparedCorridor,
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
  out: Int32Array,
  visits: VisitMarks,
  lows: Float64Array,
  highs: Float64Array,
  work: { count: number },
): number {
  const ky = corridor.ky;
  const kx = ky * Math.cos((aLat * Math.PI) / 180);
  const totalX = (bLon - aLon) * kx;
  const totalY = (bLat - aLat) * ky;
  const total = Math.hypot(totalX, totalY);
  if (total === 0) return 0;
  const w = corridor.widthM;
  const w2 = w * w;
  // короткий отрезок — один кусок (один запрос сетки); длинный — куски для отсечки «середина + половина ≤ w»
  const piece = Math.max(w, CORRIDOR_POLICY.densifyStepM);
  const pieces = total <= 8 * piece ? 1 : Math.ceil(total / piece);
  const pieceLength = total / pieces;
  let outside = 0;

  for (let p = 0; p < pieces; p += 1) {
    // кусок [p, p+1] / pieces в метрах от a
    const ax = (totalX * p) / pieces;
    const ay = (totalY * p) / pieces;
    const vx = totalX / pieces;
    const vy = totalY / pieces;
    const length2 = vx * vx + vy * vy;
    const midLon = aLon + (bLon - aLon) * ((p + 0.5) / pieces);
    const midLat = aLat + (bLat - aLat) * ((p + 0.5) / pieces);
    const found = gridCandidates(
      corridor,
      midLon,
      midLat,
      pieceLength / 2 + w,
      out,
      visits.marks,
      nextVisit(visits),
    );
    work.count += found;
    // ближайший отрезок к середине: кусок внутри, если d(середины) + половина ≤ w
    const mx = ax + vx / 2;
    const my = ay + vy / 2;
    let nearest2 = Infinity;
    let count = 0;
    let full = false;
    for (let c = 0; c < found; c += 1) {
      const j = out[c]!;
      const cx = (corridor.lon[j]! - aLon) * kx;
      const cy = (corridor.lat[j]! - aLat) * ky;
      const ex = (corridor.lon[j + 1]! - aLon) * kx - cx;
      const ey = (corridor.lat[j + 1]! - aLat) * ky - cy;
      const segment2 = ex * ex + ey * ey;
      // расстояние от середины куска до отрезка маршрута
      let t = ((mx - cx) * ex + (my - cy) * ey) / segment2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const fx = mx - cx - t * ex;
      const fy = my - cy - t * ey;
      const mid2 = fx * fx + fy * fy;
      if (mid2 < nearest2) nearest2 = mid2;
      // капсула дальше w + половины куска от середины — не пересекает кусок
      const reach = w + pieceLength / 2;
      if (mid2 > reach * reach) continue;
      let lo = Infinity;
      let hi = -Infinity;
      // круги вокруг концов отрезка маршрута: |a + u·v − P|² ≤ w²
      for (let end = 0; end < 2; end += 1) {
        const px = (end === 0 ? cx : cx + ex) - ax;
        const py = (end === 0 ? cy : cy + ey) - ay;
        const half = (vx * px + vy * py) / length2;
        const disc = half * half - (px * px + py * py - w2) / length2;
        if (disc < 0) continue;
        const root = Math.sqrt(disc);
        if (half - root < lo) lo = half - root;
        if (half + root > hi) hi = half + root;
      }
      // полоса вдоль отрезка: проекция в [0, L], поперечное смещение в [−w, w]
      const segment = Math.sqrt(segment2);
      const ux = ex / segment;
      const uy = ey / segment;
      let from = -Infinity;
      let to = Infinity;
      const baseT = (ax - cx) * ux + (ay - cy) * uy;
      const slopeT = vx * ux + vy * uy;
      const baseN = -(ax - cx) * uy + (ay - cy) * ux;
      const slopeN = -vx * uy + vy * ux;
      if (slopeT === 0) {
        if (baseT < 0 || baseT > segment) to = -Infinity;
      } else {
        const u0 = -baseT / slopeT;
        const u1 = (segment - baseT) / slopeT;
        from = Math.max(from, Math.min(u0, u1));
        to = Math.min(to, Math.max(u0, u1));
      }
      if (slopeN === 0) {
        if (baseN < -w || baseN > w) to = -Infinity;
      } else {
        const u0 = (-w - baseN) / slopeN;
        const u1 = (w - baseN) / slopeN;
        from = Math.max(from, Math.min(u0, u1));
        to = Math.min(to, Math.max(u0, u1));
      }
      if (from <= to) {
        if (from < lo) lo = from;
        if (to > hi) hi = to;
      }
      lo = lo < 0 ? 0 : lo;
      hi = hi > 1 ? 1 : hi;
      if (lo <= 0 && hi >= 1) {
        full = true;
        break;
      }
      if (lo < hi) {
        lows[count] = lo;
        highs[count] = hi;
        count += 1;
      }
    }
    if (full || Math.sqrt(nearest2) + pieceLength / 2 <= w) continue;
    outside += pieceLength * (1 - unionLength(lows, highs, count));
  }
  return Math.max(0, outside);
}

/** Длина объединения интервалов [lows[i], highs[i]]: начала и концы сортируются отдельно, проход со счётчиком. */
function unionLength(lows: Float64Array, highs: Float64Array, count: number): number {
  insertionSort(lows, count);
  insertionSort(highs, count);
  let covered = 0;
  let active = 0;
  let since = 0;
  let i = 0;
  let j = 0;
  while (i < count || j < count) {
    if (i < count && lows[i]! <= highs[j]!) {
      if (active === 0) since = lows[i]!;
      active += 1;
      i += 1;
    } else {
      active -= 1;
      if (active === 0) covered += highs[j]! - since;
      j += 1;
    }
  }
  return covered;
}

function insertionSort(values: Float64Array, count: number): void {
  for (let i = 1; i < count; i += 1) {
    const value = values[i]!;
    let at = i;
    while (at > 0 && values[at - 1]! > value) {
      values[at] = values[at - 1]!;
      at -= 1;
    }
    values[at] = value;
  }
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
