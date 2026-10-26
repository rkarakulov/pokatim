import { haversineMeters, type TrackPoint } from './geo.ts';
import { TrackParseError, type ParsedPoint, type TrackSummary } from './track.ts';

/** Интервал «в движении»: средняя скорость не ниже 1 м/с (3,6 км/ч) … */
const MOVING_MIN_SPEED_MPS = 1;
/** … и не длиннее 5 мин (дольше — пауза записи/автопауза, а не езда). */
const MOVING_MAX_GAP_SEC = 300;
/** Гистерезис набора высоты: колебания барометра/GPS меньше порога не копятся. */
const ELEVATION_NOISE_M = 3;

/**
 * Итоги по очищенным точкам (`sanitizePoints`): время по первой и последней точке со временем,
 * дистанция — haversine по всем точкам, `movingSec` — сумма интервалов между соседними точками со временем,
 * где средняя скорость ≥ 1 м/с и интервал ≤ 5 мин. Нет хотя бы двух точек со временем — `no_timestamps`.
 */
export function summarizeTrack(points: readonly ParsedPoint[]): TrackSummary {
  let first: Date | undefined;
  let last: Date | undefined;
  let distanceM = 0;
  let movingSec = 0;
  let timed = 0;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    if (point.time !== undefined) {
      first ??= point.time;
      timed += 1;
      last = point.time;
    }
    if (i === 0) continue;
    const prev = points[i - 1]!;
    const stepM = haversineMeters(prev, point);
    distanceM += stepM;
    if (prev.time !== undefined && point.time !== undefined) {
      const dtSec = (point.time.getTime() - prev.time.getTime()) / 1000;
      if (dtSec > 0 && dtSec <= MOVING_MAX_GAP_SEC && stepM / dtSec >= MOVING_MIN_SPEED_MPS) {
        movingSec += dtSec;
      }
    }
  }

  if (first === undefined || last === undefined || timed < 2) {
    throw new TrackParseError('no_timestamps');
  }
  return {
    startedAt: new Date(first.getTime()),
    endedAt: new Date(last.getTime()),
    elapsedSec: Math.round((last.getTime() - first.getTime()) / 1000),
    movingSec: Math.round(movingSec),
    distanceM: Math.round(distanceM),
    elevationGainM: elevationGainM(points),
  };
}

/** Набор высоты, м (целое), с гистерезисом 3 м; `null` — в точках нет высот. Общий для заездов и маршрутов. */
export function elevationGainM(points: readonly TrackPoint[]): number | null {
  let reference: number | undefined;
  let gain = 0;
  for (const { ele } of points) {
    if (ele === undefined || !Number.isFinite(ele)) continue;
    if (reference === undefined) {
      reference = ele;
    } else if (ele - reference >= ELEVATION_NOISE_M) {
      gain += ele - reference;
      reference = ele;
    } else if (reference - ele >= ELEVATION_NOISE_M) {
      reference = ele;
    }
  }
  return reference === undefined ? null : Math.round(gain);
}
