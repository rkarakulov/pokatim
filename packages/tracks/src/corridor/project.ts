import { haversineMeters } from '../geo.ts';
import type { ParsedPoint } from '../track.ts';
import { CORRIDOR_POLICY } from './policy.ts';
import { gridCandidates } from './prepare.ts';
import type { PreparedCorridor } from './types.ts';

/** Точки заезда, привязанные к маршруту (без точек без времени и без выбросов). */
export interface ProjectedTrack {
  count: number;
  /** исходные точки (для haversine) */
  points: ParsedPoint[];
  /** мс */
  time: Float64Array;
  /** отклонение от линии маршрута, м; `Infinity` — нет отрезков в радиусе поиска */
  d: Float64Array;
  /** пройденная доля маршрута, м; у петли — без свёртки по кругам (второй круг — L…2L) */
  s: Float64Array;
  /** 1 — d ≤ widthM */
  inside: Uint8Array;
  /** длина шага к следующей точке, м (haversine) */
  step: Float64Array;
  /** моменты выбросов, мс, по возрастанию */
  noiseTimes: Float64Array;
}

/**
 * Привязка точек (§7.2). Выбросы — окно из 1–2 точек, в которое и из которого скорость > 30 м/с, а в обход —
 * правдоподобна. Кандидаты точки — ветви маршрута в радиусе `max(3·widthM, 150 м)`: локальные минимумы расстояния
 * вдоль линии (проекция внутрь отрезка или на вершину «снаружи угла»), не больше `maxBranches` ближайших.
 * `s` — путь минимальной суммарной стоимости по всему треку (Витерби): `Σ d + λ·|(s − s_prev) − Δgeo|`, `Δgeo` —
 * пройденное по треку с предыдущей привязанной точки; у петли кандидат сдвигается на целое число кругов к
 * `s_prev + Δgeo`. Просмотр вперёд: разворот раньше точки маршрута — скачок на обратную ветку один раз, а не
 * обратный ход по прямой ветке. `d` — расстояние до ближайшего отрезка (коридор — геометрия).
 */
export function projectTrack(
  points: readonly ParsedPoint[],
  corridor: PreparedCorridor,
): ProjectedTrack {
  const timed = points.filter((point) => point.time !== undefined);
  const noise = flagSpikes(timed);
  const kept: ParsedPoint[] = [];
  const noiseTimes: number[] = [];
  for (let i = 0; i < timed.length; i += 1) {
    if (noise[i] === 1) noiseTimes.push(timed[i]!.time!.getTime());
    else kept.push(timed[i]!);
  }

  const count = kept.length;
  const time = new Float64Array(count);
  const d = new Float64Array(count);
  const step = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    time[k] = kept[k]!.time!.getTime();
    if (k + 1 < count) step[k] = haversineMeters(kept[k]!, kept[k + 1]!);
  }

  const branches = collectBranches(kept, corridor, d);
  const s = viterbi(branches, step, corridor);
  const inside = new Uint8Array(count);
  for (let k = 0; k < count; k += 1) inside[k] = d[k]! <= corridor.widthM ? 1 : 0;

  return {
    count,
    points: kept,
    time,
    d,
    s,
    inside,
    step,
    noiseTimes: Float64Array.from(noiseTimes),
  };
}

interface Branches {
  /** число ветвей у точки (0 — вне радиуса поиска) */
  size: Uint8Array;
  /** chainage ветвей (по возрастанию), `maxBranches` на точку */
  s: Float64Array;
  /** расстояние до ветви */
  d: Float32Array;
}

function collectBranches(
  points: readonly ParsedPoint[],
  corridor: PreparedCorridor,
  dOut: Float64Array,
): Branches {
  const K = CORRIDOR_POLICY.maxBranches;
  const count = points.length;
  const size = new Uint8Array(count);
  const bs = new Float64Array(count * K);
  const bd = new Float32Array(count * K);
  const segments = corridor.lon.length - 1;
  const out = new Int32Array(segments);
  const stamp = new Int32Array(segments);
  const radius = CORRIDOR_POLICY.searchRadius(corridor.widthM);
  // буферы без аллокаций на точку (200 000 точек — память потока worker)
  const foundS: number[] = [];
  const foundD: number[] = [];
  const order: number[] = [];
  const projection = new Float64Array(3); // raw t, t, расстояние

  const project = (j: number, lon: number, lat: number) => {
    const kx = corridor.segKx[j]!;
    const px = (lon - corridor.lon[j]!) * kx;
    const py = (lat - corridor.lat[j]!) * corridor.ky;
    const dx = (corridor.lon[j + 1]! - corridor.lon[j]!) * kx;
    const dy = (corridor.lat[j + 1]! - corridor.lat[j]!) * corridor.ky;
    const raw = (px * dx + py * dy) / (dx * dx + dy * dy);
    const t = Math.max(0, Math.min(1, raw));
    projection[0] = raw;
    projection[1] = t;
    projection[2] = Math.hypot(px - t * dx, py - t * dy);
  };
  /** a раньше b: по возрастанию s, затем d */
  const bySD = (a: number, b: number) =>
    foundS[a]! < foundS[b]! || (foundS[a] === foundS[b] && foundD[a]! < foundD[b]!);

  for (let k = 0; k < count; k += 1) {
    const { lon, lat } = points[k]!;
    const found = gridCandidates(corridor, lon, lat, radius, out, stamp, k + 1);
    foundS.length = 0;
    foundD.length = 0;
    let minD = Infinity;
    for (let c = 0; c < found; c += 1) {
      const j = out[c]!;
      project(j, lon, lat);
      const raw = projection[0]!;
      const t = projection[1]!;
      const dist = projection[2]!;
      if (dist > radius) continue;
      minD = Math.min(minD, dist);
      // ветвь — локальный минимум расстояния вдоль линии: проекция внутрь отрезка или вершина «снаружи угла»
      if (raw <= 0 && j > 0) {
        project(j - 1, lon, lat);
        if (projection[0]! < 1) continue;
      }
      if (raw >= 1 && j < segments - 1) {
        project(j + 1, lon, lat);
        if (projection[0]! > 0) continue;
      }
      foundS.push(corridor.chainage[j]! + t * (corridor.chainage[j + 1]! - corridor.chainage[j]!));
      foundD.push(dist);
    }
    dOut[k] = minD;
    if (foundS.length === 0) continue;

    // вставками по (s, d); совпадающие s (вершина двух отрезков) — одна ветвь с меньшим d
    order.length = 0;
    for (let i = 0; i < foundS.length; i += 1) {
      let at = order.length;
      order.push(i);
      while (at > 0 && bySD(i, order[at - 1]!)) {
        order[at] = order[at - 1]!;
        at -= 1;
      }
      order[at] = i;
    }
    let unique = 0;
    for (const i of order) {
      if (unique === 0 || foundS[i] !== foundS[order[unique - 1]!]) {
        order[unique] = i;
        unique += 1;
      }
    }
    order.length = unique;
    // больше K — K ближайших (при равенстве — меньшая s), порядок по s сохраняется
    while (order.length > K) {
      let worst = 0;
      for (let i = 1; i < order.length; i += 1) {
        const a = order[i]!;
        const b = order[worst]!;
        if (foundD[a]! > foundD[b]! || (foundD[a] === foundD[b] && foundS[a]! > foundS[b]!)) {
          worst = i;
        }
      }
      order.splice(worst, 1);
    }
    size[k] = order.length;
    for (let c = 0; c < order.length; c += 1) {
      bs[k * K + c] = foundS[order[c]!]!;
      bd[k * K + c] = foundD[order[c]!]!;
    }
  }
  return { size, s: bs, d: bd };
}

/**
 * Путь минимальной стоимости по ветвям всех привязанных точек. Ветви без радиуса поиска пропускаются, их `s` —
 * от предыдущей привязанной точки (до первой — 0). Равные стоимости — меньший индекс ветви (меньшая s).
 */
function viterbi(branches: Branches, step: Float64Array, corridor: PreparedCorridor): Float64Array {
  const K = CORRIDOR_POLICY.maxBranches;
  const lambda = CORRIDOR_POLICY.matchLambda;
  const L = corridor.lengthM;
  const count = branches.size.length;
  // s ветви заменяется на месте развёрнутой (при лучшем предшественнике, петля) — без второго массива
  const unwrapped = branches.s;
  const back = new Uint8Array(count * K);
  let cost = new Float64Array(K);
  let next = new Float64Array(K);
  let prev = -1;
  let geo = 0;

  for (let k = 0; k < count; k += 1) {
    if (k > 0) geo += step[k - 1]!;
    const n = branches.size[k]!;
    if (n === 0) continue;
    if (prev < 0) {
      for (let c = 0; c < n; c += 1) cost[c] = branches.d[k * K + c]!;
    } else {
      const m = branches.size[prev]!;
      let floor = Infinity;
      for (let c = 0; c < n; c += 1) {
        const sc = unwrapped[k * K + c]!;
        let best = Infinity;
        let bestJ = 0;
        let bestU = sc;
        for (let j = 0; j < m; j += 1) {
          const expected = unwrapped[prev * K + j]! + geo;
          const u = corridor.isLoop ? sc + Math.round((expected - sc) / L) * L : sc;
          const total = cost[j]! + lambda * Math.abs(u - expected);
          if (total < best) {
            best = total;
            bestJ = j;
            bestU = u;
          }
        }
        next[c] = best + branches.d[k * K + c]!;
        back[k * K + c] = bestJ;
        unwrapped[k * K + c] = bestU;
        floor = Math.min(floor, next[c]!);
      }
      // нормировка: относительные стоимости, без роста величин на длинном треке
      for (let c = 0; c < n; c += 1) next[c] = next[c]! - floor;
      const swap = cost;
      cost = next;
      next = swap;
    }
    prev = k;
    geo = 0;
  }

  const s = new Float64Array(count);
  if (prev < 0) return s;
  let state = 0;
  for (let c = 1; c < branches.size[prev]!; c += 1) if (cost[c]! < cost[state]!) state = c;
  for (let k = prev; k >= 0; k -= 1) {
    if (branches.size[k] === 0) continue;
    s[k] = unwrapped[k * K + state]!;
    const from = back[k * K + state]!;
    state = from;
  }
  // петля: пути, сдвинутые на целое число кругов, равноценны — первая привязанная точка в [0, L)
  if (corridor.isLoop) {
    const first = branches.size.findIndex((size) => size > 0);
    const shift = Math.floor(s[first]! / L) * L;
    if (shift !== 0) for (let k = 0; k < count; k += 1) s[k] = s[k]! - shift;
  }
  // точки вне радиуса поиска — s предыдущей привязанной (до первой привязанной — 0)
  let last = Number.NaN;
  for (let k = 0; k < count; k += 1) {
    if (branches.size[k]! > 0) last = s[k]!;
    else s[k] = Number.isNaN(last) ? 0 : last;
  }
  return s;
}

/**
 * 1 — выброс: окно из 1–2 точек, в которое (от последней принятой) и из которого скорость выше `spikeSpeedMps`,
 * а переход от последней принятой точки сразу за окно — правдоподобен.
 */
function flagSpikes(points: readonly ParsedPoint[]): Uint8Array {
  const flags = new Uint8Array(points.length);
  const limit = CORRIDOR_POLICY.spikeSpeedMps;
  const speed = (a: ParsedPoint, b: ParsedPoint) => {
    const meters = haversineMeters(a, b);
    const seconds = (b.time!.getTime() - a.time!.getTime()) / 1000;
    if (seconds > 0) return meters / seconds;
    return meters > 0 ? Infinity : 0;
  };
  let last = 0;
  for (let i = 1; i < points.length;) {
    let width = 0;
    for (let w = 1; w <= 2 && i + w < points.length; w += 1) {
      if (
        speed(points[last]!, points[i]!) > limit &&
        speed(points[i + w - 1]!, points[i + w]!) > limit &&
        speed(points[last]!, points[i + w]!) <= limit
      ) {
        width = w;
        break;
      }
    }
    if (width > 0) {
      for (let w = 0; w < width; w += 1) flags[i + w] = 1;
      i += width;
    } else {
      last = i;
      i += 1;
    }
  }
  return flags;
}
