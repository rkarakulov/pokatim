import { haversineMeters } from '../geo.ts';
import type { ParsedPoint } from '../track.ts';
import type { OffRunMs } from './match.ts';
import type { CorridorSegment } from './types.ts';

/** Предел интервалов схода в разметке: больше — сливаются пары с наименьшим зазором. */
export const TRACK_MAP_MAX_RUNS = 100;
/** Шаг округления позиций на линии. */
const POSITION_STEP = 1000;

/**
 * Разметка трека попытки на упрощённой линии показа (`activity_tracks.line`): позиции — дробный индекс вершины
 * `i + t` (`0 ≤ t < 1` — доля пути по отрезку `[i, i + 1]`), кратны 0,001, в `[0, linePoints − 1]`. Без координат и
 * времени точек.
 */
export interface TrackMap {
  /** число точек линии, по которой посчитаны позиции (сверка при чтении) */
  linePoints: number;
  /** выход из ворот старта и вход в ворота финиша (конец просмотра) */
  segment: [number, number] | null;
  /** выходы из коридора внутри `segment`, по возрастанию, не больше `TRACK_MAP_MAX_RUNS` */
  offRuns: [number, number][];
}

type Mode = 'start' | 'end';

/**
 * Привязка сегмента и интервалов схода (время трека, мс) к сохранённой линии показа `line` ([lon, lat] из
 * `activity_tracks` — `simplifyTrack` по тем же `points`; линия не пересчитывается, §8.2 maps-02). Вершины сопоставляются с точками исходника последовательно по точному равенству координат.
 * Момент → путь по исходнику: среди точек со временем — бинарный поиск
 * (равные времена: начало интервала — первая точка, конец — последняя), между соседними — линейно по времени; путь —
 * накопленная haversine-длина по всем `points` (с точками без времени). Путь → позиция на отрезке линии между
 * вершинами по их накопленному пути. Ошибка поперёк — допуск упрощения, вдоль — метры (хорды ≠ отрезки линии);
 * стоянки и точки без времени позицию не сдвигают. `null` — нет сегмента, линии, линия < 2 точек или вершина не
 * найдена в исходнике (линия от другого файла или версии упрощения).
 */
export function trackMapOf(
  points: readonly ParsedPoint[],
  line: readonly (readonly [number, number])[] | null,
  segment: CorridorSegment | null,
  offRunsMs: readonly OffRunMs[],
): TrackMap | null {
  if (segment === null || line === null || line.length < 2) return null;
  const locate = locator(points, line);
  if (locate === null) return null;
  const last = line.length - 1;
  const round = (position: number) =>
    Math.min(last, Math.max(0, Math.round(position * POSITION_STEP) / POSITION_STEP));
  const from = round(locate(segment.startedAt.getTime(), 'start'));
  const to = round(locate(segment.finishedAt.getTime(), 'end'));

  const runs: [number, number][] = [];
  for (const [startMs, endMs] of offRunsMs) {
    const a = Math.max(from, round(locate(startMs, 'start')));
    const b = Math.min(to, round(locate(endMs, 'end')));
    if (b <= a) continue;
    const previous = runs[runs.length - 1];
    if (previous !== undefined && a <= previous[1]) previous[1] = Math.max(previous[1], b);
    else runs.push([a, b]);
  }
  return { linePoints: line.length, segment: [from, to], offRuns: limitRuns(runs) };
}

/** Момент (мс) → позиция на линии. */
function locator(
  points: readonly ParsedPoint[],
  line: readonly (readonly [number, number])[],
): ((timeMs: number, mode: Mode) => number) | null {
  const cum = new Float64Array(points.length);
  for (let j = 1; j < points.length; j += 1) {
    cum[j] = cum[j - 1]! + haversineMeters(points[j - 1]!, points[j]!);
  }
  // путь вершин линии: вершины — точки исходника в том же порядке (первая из подряд одинаковых), проход O(n)
  const vertexCum = new Float64Array(line.length);
  let j = 0;
  for (let i = 0; i < line.length; i += 1) {
    const [lon, lat] = line[i]!;
    while (j < points.length && (points[j]!.lon !== lon || points[j]!.lat !== lat)) j += 1;
    if (j === points.length) return null;
    vertexCum[i] = cum[j]!;
  }
  const timedIndex: number[] = [];
  const times: number[] = [];
  points.forEach((point, index) => {
    if (point.time !== undefined) {
      timedIndex.push(index);
      times.push(point.time.getTime());
    }
  });

  const pathAt = (timeMs: number, mode: Mode): number => {
    const n = times.length;
    if (n === 0) return 0;
    if (timeMs <= times[0]!) return cum[timedIndex[0]!]!;
    if (timeMs >= times[n - 1]!) return cum[timedIndex[n - 1]!]!;
    // первый индекс со временем ≥ t (start) или > t (end)
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const before = mode === 'start' ? times[mid]! < timeMs : times[mid]! <= timeMs;
      if (before) lo = mid + 1;
      else hi = mid;
    }
    if (mode === 'start' && times[lo] === timeMs) return cum[timedIndex[lo]!]!;
    if (mode === 'end' && times[lo - 1] === timeMs) return cum[timedIndex[lo - 1]!]!;
    const a = lo - 1;
    const b = lo;
    const share = (timeMs - times[a]!) / (times[b]! - times[a]!);
    const pathA = cum[timedIndex[a]!]!;
    return pathA + share * (cum[timedIndex[b]!]! - pathA);
  };

  return (timeMs, mode) => {
    const path = pathAt(timeMs, mode);
    const last = line.length - 1;
    if (path <= vertexCum[0]!) return 0;
    if (path >= vertexCum[last]!) return last;
    // последняя вершина с путём ≤ path
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (vertexCum[mid]! <= path) lo = mid;
      else hi = mid;
    }
    const length = vertexCum[lo + 1]! - vertexCum[lo]!;
    return length > 0 ? lo + (path - vertexCum[lo]!) / length : lo;
  };
}

/** Больше `TRACK_MAP_MAX_RUNS` — сливаются соседние с наименьшим зазором (при равенстве — левее). */
function limitRuns(runs: [number, number][]): [number, number][] {
  const excess = runs.length - TRACK_MAP_MAX_RUNS;
  if (excess <= 0) return runs;
  const gaps = runs.slice(0, -1).map((run, i) => ({ i, gap: runs[i + 1]![0] - run[1] }));
  gaps.sort((a, b) => a.gap - b.gap || a.i - b.i);
  const merge = new Uint8Array(runs.length);
  for (let k = 0; k < excess; k += 1) merge[gaps[k]!.i] = 1;
  const result: [number, number][] = [];
  let current: [number, number] = [...runs[0]!];
  for (let i = 1; i < runs.length; i += 1) {
    if (merge[i - 1] === 1) current[1] = runs[i]![1];
    else {
      result.push(current);
      current = [...runs[i]!];
    }
  }
  result.push(current);
  return result;
}
