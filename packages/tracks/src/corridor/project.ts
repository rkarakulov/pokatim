import { haversineMeters } from '../geo.ts';
import { TrackParseError, type ParsedPoint } from '../track.ts';
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
  /** ближайший отрезок маршрута (−1 — вне радиуса поиска) */
  nearest: Int32Array;
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

  assertPlausible(kept, time);

  const nearest = new Int32Array(count).fill(-1);
  const branches = collectBranches(kept, corridor, d, nearest);
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
    nearest,
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
  nearestOut: Int32Array,
): Branches {
  const K = CORRIDOR_POLICY.maxBranches;
  const count = points.length;
  const size = new Uint8Array(count);
  const bs = new Float64Array(count * K);
  const bd = new Float32Array(count * K);
  const segments = corridor.lon.length - 1;
  const out = new Int32Array(segments);
  const stamp = new Int32Array(segments);
  // сначала — вся ширина коридора (точка внутри: все ветви коридора — кандидаты Витерби), пусто — полный радиус
  const near = corridor.widthM;
  const radius = CORRIDOR_POLICY.searchRadius(corridor.widthM);
  const { lon: vLon, lat: vLat, chainage, segKx, segDx, segDy, segLength2, ky } = corridor;
  // K ближайших ветвей точки по (d, s) — без аллокаций на точку (200 000 точек — память потока worker)
  const keptS = new Float64Array(K);
  const keptD = new Float64Array(K);

  /** Параметр проекции точки на отрезок j без обрезки (< 0 — до начала, > 1 — за концом). */
  const rawT = (j: number, lon: number, lat: number) =>
    ((lon - vLon[j]!) * segKx[j]! * segDx[j]! + (lat - vLat[j]!) * ky * segDy[j]!) / segLength2[j]!;

  for (let k = 0; k < count; k += 1) {
    const { lon, lat } = points[k]!;
    let kept = 0;
    let minD2 = Infinity;
    for (let pass = 0; pass < 2; pass += 1) {
      const reach = pass === 0 ? near : radius;
      const radius2 = reach * reach;
      const found = gridCandidates(corridor, lon, lat, reach, out, stamp, 2 * k + 1 + pass);
      for (let c = 0; c < found; c += 1) {
        const j = out[c]!;
        const px = (lon - vLon[j]!) * segKx[j]!;
        const py = (lat - vLat[j]!) * ky;
        const dx = segDx[j]!;
        const dy = segDy[j]!;
        const raw = (px * dx + py * dy) / segLength2[j]!;
        const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        const ex = px - t * dx;
        const ey = py - t * dy;
        const dist2 = ex * ex + ey * ey;
        if (dist2 > radius2) continue;
        if (dist2 < minD2) {
          minD2 = dist2;
          nearestOut[k] = j;
        }
        // ветвь — локальный минимум расстояния вдоль линии: проекция внутрь отрезка или вершина «снаружи угла»
        if (raw <= 0 && j > 0 && rawT(j - 1, lon, lat) < 1) continue;
        if (raw >= 1 && j < segments - 1 && rawT(j + 1, lon, lat) > 0) continue;
        const sc = chainage[j]! + t * (chainage[j + 1]! - chainage[j]!);
        const dc = Math.sqrt(dist2);
        // та же s (вершина двух отрезков) — одна ветвь с меньшим d
        let same = -1;
        for (let i = 0; i < kept; i += 1) if (keptS[i] === sc) same = i;
        if (same >= 0) {
          if (dc >= keptD[same]!) continue;
          // удалить и вставить заново по (d, s)
          for (let i = same; i + 1 < kept; i += 1) {
            keptS[i] = keptS[i + 1]!;
            keptD[i] = keptD[i + 1]!;
          }
          kept -= 1;
        }
        // вставка в K ближайших, упорядоченных по (d, s)
        let at = kept;
        while (at > 0 && (dc < keptD[at - 1]! || (dc === keptD[at - 1] && sc < keptS[at - 1]!))) {
          at -= 1;
        }
        if (at >= K) continue;
        for (let i = Math.min(kept, K - 1); i > at; i -= 1) {
          keptS[i] = keptS[i - 1]!;
          keptD[i] = keptD[i - 1]!;
        }
        keptS[at] = sc;
        keptD[at] = dc;
        if (kept < K) kept += 1;
      }
      if (kept > 0 && minD2 <= near * near) break;
    }
    dOut[k] = Math.sqrt(minD2);
    if (kept === 0) continue;
    // ветви точки — по возрастанию s (порядок состояний Витерби)
    size[k] = kept;
    const base = k * K;
    for (let i = 0; i < kept; i += 1) {
      let at = i;
      while (at > 0 && bs[base + at - 1]! > keptS[i]!) {
        bs[base + at] = bs[base + at - 1]!;
        bd[base + at] = bd[base + at - 1]!;
        at -= 1;
      }
      bs[base + at] = keptS[i]!;
      bd[base + at] = keptD[i]!;
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
 * Правдоподобие трека до привязки: средняя скорость по **сглаженному** пути (точки через ≥ 10 с или ≥ 100 м — шум
 * GPS между ними не копится) не выше `spikeSpeedMps` (108 км/ч), иначе `TrackParseError('implausible')`, как у
 * разбора. Честный быстрый проезд с шумом, медленная запись и стоянки с дрожанием проходят.
 */
function assertPlausible(points: readonly ParsedPoint[], time: Float64Array): void {
  const count = points.length;
  if (count < 2) return;
  const policy = CORRIDOR_POLICY;
  let smoothed = 0;
  let anchor = 0;
  for (let k = 1; k < count; k += 1) {
    const last = k === count - 1;
    if (last || time[k]! - time[anchor]! >= policy.plausibilityIntervalS * 1000) {
      smoothed += haversineMeters(points[anchor]!, points[k]!);
      anchor = k;
    } else {
      const distance = haversineMeters(points[anchor]!, points[k]!);
      if (distance >= policy.plausibilityDistanceM) {
        smoothed += distance;
        anchor = k;
      }
    }
  }
  const seconds = Math.max(1, (time[count - 1]! - time[0]!) / 1000);
  if (smoothed > policy.spikeSpeedMps * seconds) throw new TrackParseError('implausible');
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
