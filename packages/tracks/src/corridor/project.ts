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
 * Привязка точек (§7.2): выбросы (скорость в точку и из неё > 30 м/с) отбрасываются; кандидаты — отрезки в радиусе
 * `max(3·widthM, 150 м)`; `s` — минимум стоимости `d + λ·|(s − s_prev) − Δgeo|` (первая привязанная точка —
 * минимум `d`, при равенстве меньшая `s`); `Δgeo` — пройденное по треку с последней привязанной точки. Петля:
 * кандидат сдвигается на целое число кругов к ожидаемому `s_prev + Δgeo`. `d` — расстояние до ближайшего отрезка
 * (коридор — геометрия), `s` — по стоимости (монотонность на «туда-обратно», петлях, восьмёрках).
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
  const s = new Float64Array(count);
  const inside = new Uint8Array(count);
  const step = new Float64Array(count);
  const segments = corridor.lon.length - 1;
  const out = new Int32Array(segments);
  const stamp = new Int32Array(segments);
  const radius = CORRIDOR_POLICY.searchRadius(corridor.widthM);
  const lambda = CORRIDOR_POLICY.matchLambda;
  const L = corridor.lengthM;

  let sPrev = Number.NaN;
  let geoSince = 0;
  for (let k = 0; k < count; k += 1) {
    const point = kept[k]!;
    time[k] = point.time!.getTime();
    if (k + 1 < count) step[k] = haversineMeters(point, kept[k + 1]!);
    if (k > 0) geoSince += step[k - 1]!;

    const found = gridCandidates(corridor, point.lon, point.lat, radius, out, stamp, k + 1);
    let bestCost = Infinity;
    let bestS = Number.NaN;
    let minD = Infinity;
    for (let c = 0; c < found; c += 1) {
      const j = out[c]!;
      const kx = corridor.segKx[j]!;
      const px = (point.lon - corridor.lon[j]!) * kx;
      const py = (point.lat - corridor.lat[j]!) * corridor.ky;
      const dx = (corridor.lon[j + 1]! - corridor.lon[j]!) * kx;
      const dy = (corridor.lat[j + 1]! - corridor.lat[j]!) * corridor.ky;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
      const dist = Math.hypot(px - t * dx, py - t * dy);
      if (dist > radius) continue;
      let sc = corridor.chainage[j]! + t * (corridor.chainage[j + 1]! - corridor.chainage[j]!);
      let cost = dist;
      if (!Number.isNaN(sPrev)) {
        const expected = sPrev + geoSince;
        if (corridor.isLoop) sc += Math.round((expected - sc) / L) * L;
        cost += lambda * Math.abs(sc - expected);
      }
      if (cost < bestCost || (cost === bestCost && sc < bestS)) {
        bestCost = cost;
        bestS = sc;
      }
      minD = Math.min(minD, dist);
    }

    if (Number.isNaN(bestS)) {
      d[k] = Infinity;
      s[k] = Number.isNaN(sPrev) ? 0 : sPrev;
    } else {
      d[k] = minD;
      s[k] = bestS;
      sPrev = bestS;
      geoSince = 0;
    }
    inside[k] = d[k]! <= corridor.widthM ? 1 : 0;
  }

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

/** 1 — выброс: подразумеваемая скорость и в точку, и из неё выше `spikeSpeedMps`. */
function flagSpikes(points: readonly ParsedPoint[]): Uint8Array {
  const flags = new Uint8Array(points.length);
  const speed = (a: ParsedPoint, b: ParsedPoint) => {
    const meters = haversineMeters(a, b);
    const seconds = (b.time!.getTime() - a.time!.getTime()) / 1000;
    if (seconds > 0) return meters / seconds;
    return meters > 0 ? Infinity : 0;
  };
  for (let i = 1; i + 1 < points.length; i += 1) {
    if (
      speed(points[i - 1]!, points[i]!) > CORRIDOR_POLICY.spikeSpeedMps &&
      speed(points[i]!, points[i + 1]!) > CORRIDOR_POLICY.spikeSpeedMps
    ) {
      flags[i] = 1;
    }
  }
  return flags;
}
